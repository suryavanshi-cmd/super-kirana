// ocr — reads a shopping list from a photo with OCR.space (https://ocr.space/OCRAPI).
// Engine 3 first (handwriting, 200+ languages), Engine 2 as a fallback (printed Marathi/English).
// The API key lives only in the OCR_SPACE_API_KEY function secret.
//
// Privacy: the photo is held in memory for this request only. It is never written to storage and
// never logged. Only the recognised text goes back to the caller.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const OCR_KEY = Deno.env.get('OCR_SPACE_API_KEY') ?? '';
const OCR_URL = Deno.env.get('OCR_SPACE_URL') ?? 'https://api.ocr.space/parse/image';
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

interface OcrSpaceResponse {
  ParsedResults?: { ParsedText?: string }[];
  IsErroredOnProcessing?: boolean;
  OCRExitCode?: number;
}

async function readWith(engine: 2 | 3, dataUrl: string): Promise<string | null> {
  const form = new FormData();
  form.set('base64Image', dataUrl);
  form.set('OCREngine', String(engine));
  form.set('isTable', 'true');            // keep one list item per line
  form.set('scale', 'true');
  form.set('detectOrientation', 'true');
  if (engine === 2) form.set('language', 'auto');
  const res = await fetch(OCR_URL, { method: 'POST', headers: { apikey: OCR_KEY }, body: form, signal: AbortSignal.timeout(40_000) });
  if (!res.ok) { await res.body?.cancel(); return null; }
  const out = (await res.json()) as OcrSpaceResponse;
  if (out.IsErroredOnProcessing) return null;
  const text = (out.ParsedResults ?? []).map((r) => r.ParsedText ?? '').join('\n').replace(/\r/g, '').trim();
  return text || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const b = (await req.json().catch(() => ({}))) as { shop_id?: string; image_base64?: string; mime?: string; probe?: boolean };
    // Only members of the shop may use it (my_context lists exactly the shops the caller can use).
    const { data: ctx, error } = await user.rpc('my_context');
    if (error || !ctx) return json(401, { error: 'NOT_AUTHENTICATED' });
    if (!(ctx.shops as { id: string }[]).some((s) => s.id === b.shop_id)) return json(403, { error: 'FORBIDDEN' });
    if (!OCR_KEY) return json(503, { error: 'NOT_CONFIGURED' });
    if (b.probe) return json(200, { configured: true });

    const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const { data: allowed } = await svc.rpc('svc_rate_limit', { p_key: `ocr:${ctx.user_id}`, p_max: 60, p_window_seconds: 3600 });
    if (!allowed) return json(429, { error: 'TOO_MANY_ATTEMPTS' });

    const image = typeof b.image_base64 === 'string' ? b.image_base64 : '';
    // OCR.space free plan: 1 MB per file (base64 is ~4/3 of that).
    if (!image || image.length > 1_400_000) return json(400, { error: 'IMAGE_TOO_LARGE' });
    const mime = b.mime === 'image/png' ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${image}`;
    let engine: 2 | 3 = 3;
    let text = await readWith(3, dataUrl);
    if (!text) { engine = 2; text = await readWith(2, dataUrl); }
    if (text === null) return json(200, { text: '', engine, confidence: null });
    return json(200, { text, engine, confidence: null });
  } catch {
    return json(502, { error: 'OCR_PROVIDER_ERROR' });
  }
});
