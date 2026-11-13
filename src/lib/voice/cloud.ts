'use client';
// Client for the speech-to-text backup (Gemini via our edge function).
import { supabase, SUPABASE_KEY, SUPABASE_URL } from '../supabase';

async function call(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  const { data } = await supabase().auth.getSession();
  return fetch(`${SUPABASE_URL}/functions/v1/speech-to-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), keepalive: false,
  });
}

let probe: { shop: string; ok: Promise<boolean> } | null = null;
/** Checked once per shop per page load; also wakes the server so the first command is quick. */
export function cloudSpeechAvailable(shopId: string): Promise<boolean> {
  if (probe?.shop !== shopId) {
    probe = { shop: shopId, ok: call({ shop_id: shopId, probe: true }, 8000).then((r) => r.ok).catch(() => false) };
  }
  return probe.ok;
}

async function toBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function transcribe(wav: Blob, lang: string, shopId: string): Promise<string> {
  const res = await call({ shop_id: shopId, lang, audio_base64: await toBase64(wav) }, 20_000);
  const out = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(out.error ?? 'AI_PROVIDER_ERROR');
  return out.text ?? '';
}
