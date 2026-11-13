// speech-to-text — backup speech recognition for browsers that cannot do it themselves
// (Chrome / Firefox / Edge on iPhone, the iPhone home-screen app, in-app browsers).
// Safari and Android Chrome never call this: they recognise speech on the phone, instantly and free.
//
// Input: a short mono 16 kHz WAV (one spoken command, usually 2–6 s, ~100–200 KB) recorded and
// trimmed on the phone. Output: the text. The audio is held in memory for this request only; it is
// never stored or logged. Only the shop's item names are sent as spelling hints — never customer
// names, mobiles or balances. Key: GEMINI_API_KEY secret or Vault (server only).
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const ENV_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
// Flash-Lite first: fastest and cheapest, good at short commands. Flash if it is unavailable.
const MODELS = (Deno.env.get('GEMINI_SPEECH_MODEL') ?? 'gemini-2.5-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash,gemini-flash-latest').split(',').map((s) => s.trim()).filter(Boolean);
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Gemini's own reason, short and without the key, e.g. "429 RESOURCE_EXHAUSTED: Quota exceeded …". */
function geminiReason(model: string, status: number, body: string): string {
  let msg = body;
  try { const j = JSON.parse(body) as { error?: { status?: string; message?: string } }; if (j.error) msg = `${j.error.status ?? ''}: ${j.error.message ?? ''}`; } catch { /* plain text */ }
  return `${model} ${status} ${msg}`.replace(/AIza[0-9A-Za-z_-]+/g, '[key]').replace(/\s+/g, ' ').slice(0, 220);
}

const MAX_B64 = 1_400_000;              // ≈ 1 MB of audio ≈ 30 s at 16 kHz mono 16-bit
const LANG: Record<string, string> = { 'mr-IN': 'Marathi', 'hi-IN': 'Hindi', 'en-IN': 'Indian English' };
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

let cachedKey = '';
async function aiKey(svc: ReturnType<typeof createClient>): Promise<string> {
  if (ENV_KEY) return ENV_KEY;
  if (!cachedKey) { const { data } = await svc.rpc('svc_ai_key'); cachedKey = typeof data === 'string' ? data : ''; }
  return cachedKey;
}

// Item-name hints per shop, cached for a few minutes (they change rarely; saves a query per command).
const hintCache = new Map<string, { at: number; text: string }>();
async function itemHints(svc: ReturnType<typeof createClient>, shopId: string): Promise<string> {
  const hit = hintCache.get(shopId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.text;
  const { data } = await svc.rpc('svc_bill_catalogue', { p_shop_id: shopId });
  const names = (Array.isArray(data) ? data : []).slice(0, 300).map((p: { name: string }) => p.name).join(', ');
  hintCache.set(shopId, { at: Date.now(), text: names });
  return names;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const started = Date.now();
  try {
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const b = (await req.json().catch(() => ({}))) as { shop_id?: string; audio_base64?: string; lang?: string; probe?: boolean };
    const { data: ctx, error } = await user.rpc('my_context');
    if (error || !ctx) return json(401, { error: 'NOT_AUTHENTICATED' });
    if (!(ctx.shops as { id: string }[]).some((s) => s.id === b.shop_id)) return json(403, { error: 'FORBIDDEN' });
    const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const key = await aiKey(svc);
    if (!key) return json(503, { error: 'NOT_CONFIGURED', detail: 'GEMINI_API_KEY is not set (Supabase secret or Vault gemini_api_key)' });
    if (b.probe) return json(200, { configured: true });

    const { data: allowed } = await svc.rpc('svc_rate_limit', { p_key: `stt:${ctx.user_id}`, p_max: 600, p_window_seconds: 3600 });
    if (!allowed) return json(429, { error: 'TOO_MANY_ATTEMPTS' });
    // Demo shop: each AI call uses one of the day's demo actions (real shops: always true).
    const { data: demoOk } = await svc.rpc('svc_demo_charge', { p_shop_id: b.shop_id });
    if (demoOk === false) return json(429, { error: 'DEMO_LIMIT' });
    const audio = typeof b.audio_base64 === 'string' ? b.audio_base64 : '';
    // Must be a base64 WAV ("RIFF....WAVE" → "UklGR"), within size.
    if (!audio || audio.length > MAX_B64 || !audio.startsWith('UklGR') || !/^[A-Za-z0-9+/=]+$/.test(audio.slice(0, 400))) return json(400, { error: 'INVALID_AUDIO' });
    const lang = LANG[b.lang ?? ''] ?? 'Marathi';
    const hints = await itemHints(svc, b.shop_id!);

    const prompt = [
      `Transcribe this short voice command spoken in a kirana (grocery) shop in Maharashtra, India. The main language is ${lang}; it may mix Marathi, Hindi and English.`,
      'Write Marathi and Hindi words in Devanagari, English words in Latin letters, and every number, amount, quantity and mobile number as digits.',
      'Write exactly what was said; do not translate, answer, explain or add anything. If nothing intelligible was said, return an empty text.',
      hints ? `Item names used in this shop (for spelling only): ${hints}` : '',
    ].filter(Boolean).join('\n');

    let busy = false;
    const reasons: string[] = [];
    for (const model of MODELS) {
      let res: Response;
      try {
        res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/wav', data: audio } }, { text: prompt }] }],
          generationConfig: {
            temperature: 0, maxOutputTokens: 256, responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
            ...(model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      } catch (e) {   // this model timed out or could not be reached: try the next one
        reasons.push(`${model}: ${e instanceof Error ? e.name : 'fetch failed'}`);
        continue;
      }

      if (!res.ok) {   // model unavailable / busy: note why (no audio, no key) and try the next one
        const why = geminiReason(model, res.status, await res.text().catch(() => ''));
        console.error('gemini', why);
        reasons.push(why);
        if (res.status === 429) busy = true;
        continue;
      }
      const raw = await res.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const out = (raw.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      let text = '';
      try { text = String((JSON.parse(out) as { text?: string }).text ?? ''); } catch { reasons.push(`${model}: reply was not valid JSON`); continue; }
      text = text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      return json(200, { text, model, ms: Date.now() - started });
    }
    return json(busy ? 429 : 502, { error: busy ? 'AI_BUSY' : 'AI_PROVIDER_ERROR', step: 'gemini', detail: reasons.join(' | ').slice(0, 450) || 'no model gave an answer' });
  } catch (e) {
    const why = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('speech-to-text failed', why);
    return json(502, { error: 'AI_PROVIDER_ERROR', step: 'internal', detail: why.replace(/AIza[0-9A-Za-z_-]+/g, '[key]').slice(0, 300) });
  }
});
