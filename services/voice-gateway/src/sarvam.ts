// Sarvam speech-to-text: saaras:v4 + keyterms; on error, ONE retry with saaras:v3 mode=codemix.
// Keep-alive agent reuses the TLS connection between requests (saves ~100–300 ms each time).
import { Agent, fetch, FormData } from 'undici';
import { config } from './config';
import { E, GatewayError } from './errors';

const agent = new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000, connections: 16, pipelining: 1 });

export interface SttResult { transcript: string; model: string; ms: number; retried: boolean; sarvam_request_id?: string | null }
type Fetch = typeof fetch;
let fetchImpl: Fetch = fetch;
/** Test hook: replace the network call. */
export function setSarvamFetch(f: Fetch | null) { fetchImpl = f ?? fetch; }

async function call(audio: Buffer, mime: string, model: 'saaras:v4' | 'saaras:v3', keyterms: string[]): Promise<{ transcript: string; id?: string | null }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `clip.${mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm'}`);
  form.append('model', model);
  form.append('language_code', config.sarvamLanguage);
  if (model === 'saaras:v4' && keyterms.length) form.append('keyterms', JSON.stringify(keyterms));
  if (model === 'saaras:v3') form.append('mode', 'codemix');
  let res;
  try {
    res = await fetchImpl(config.sarvamUrl, {
      method: 'POST', body: form, dispatcher: agent, signal: AbortSignal.timeout(config.sarvamTimeoutMs),
      headers: { 'api-subscription-key': config.sarvamKey },
    });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw E.sarvamTimeout(config.sarvamTimeoutMs);
    throw E.sarvam(0, `network: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let why = text.slice(0, 200);
    try { const j = JSON.parse(text) as { error?: { message?: string }; message?: string; detail?: unknown }; why = j.error?.message ?? j.message ?? JSON.stringify(j.detail ?? j).slice(0, 200); } catch { /* text */ }
    throw E.sarvam(res.status, why);
  }
  const j = JSON.parse(text) as { transcript?: string; request_id?: string | null };
  return { transcript: (j.transcript ?? '').trim(), id: j.request_id };
}

let lastWarm = 0;
/** Opens (or keeps open) the TLS connection to Sarvam so the first real request skips the ~150–300 ms
 *  handshake. A HEAD to the API host is not a transcription and costs nothing. At most once per 30 s. */
export function preconnectSarvam(): void {
  if (!config.sarvamKey || Date.now() - lastWarm < 30_000 || fetchImpl !== fetch) return;
  lastWarm = Date.now();
  void fetch(new URL('/', config.sarvamUrl), { method: 'HEAD', dispatcher: agent, signal: AbortSignal.timeout(3000) })
    .then((r) => r.body?.cancel()).catch(() => undefined);
}

export async function transcribe(audio: Buffer, mime: string, keyterms: string[]): Promise<SttResult> {
  const t0 = performance.now();
  try {
    const r = await call(audio, mime, 'saaras:v4', keyterms);
    return { transcript: r.transcript, model: 'saaras:v4', ms: Math.round(performance.now() - t0), retried: false, sarvam_request_id: r.id };
  } catch (first) {
    // Auth / credit problems will not be fixed by another model: fail fast with the real reason.
    if (first instanceof GatewayError && (first.code === 'SARVAM_AUTH' || first.code === 'SARVAM_LIMIT')) throw first;
    const r = await call(audio, mime, 'saaras:v3', []);
    return { transcript: r.transcript, model: 'saaras:v3', ms: Math.round(performance.now() - t0), retried: true, sarvam_request_id: r.id };
  }
}
