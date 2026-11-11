// ocr-vision — optional cloud OCR (Google Cloud Vision, DOCUMENT_TEXT_DETECTION) for handwritten
// and Marathi lists. Active only when the GOOGLE_VISION_API_KEY secret is set; otherwise it
// answers NOT_CONFIGURED and the app uses on-device OCR or manual entry.
//
// Privacy: the image is held in memory for the request only. It is never written to storage and
// never logged. Only the recognized text goes back to the caller.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const VISION_KEY = Deno.env.get('GOOGLE_VISION_API_KEY') ?? '';
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const b = (await req.json().catch(() => ({}))) as { shop_id?: string; image_base64?: string; probe?: boolean };
    // Membership is checked by the database (my_context only lists shops the caller can use).
    const { data: ctx, error } = await user.rpc('my_context');
    if (error || !ctx) return json(401, { error: 'NOT_AUTHENTICATED' });
    if (!(ctx.shops as { id: string }[]).some((s) => s.id === b.shop_id)) return json(403, { error: 'FORBIDDEN' });
    if (!VISION_KEY) return json(503, { error: 'NOT_CONFIGURED' });
    if (b.probe) return json(200, { configured: true });

    const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const { data: allowed } = await svc.rpc('svc_rate_limit', { p_key: `ocr:${ctx.user_id}`, p_max: 60, p_window_seconds: 3600 });
    if (!allowed) return json(429, { error: 'TOO_MANY_ATTEMPTS' });

    const image = typeof b.image_base64 === 'string' ? b.image_base64 : '';
    if (!image || image.length > 6_000_000) return json(400, { error: 'IMAGE_TOO_LARGE' });
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{
        image: { content: image },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['mr', 'en'] },
      }] }),
    });
    if (!res.ok) { await res.body?.cancel(); return json(502, { error: 'OCR_PROVIDER_ERROR' }); }
    const out = await res.json();
    const full = out?.responses?.[0]?.fullTextAnnotation;
    const blocks = (full?.pages ?? []).flatMap((p: { blocks?: { confidence?: number }[] }) => p.blocks ?? []);
    const conf = blocks.length
      ? blocks.reduce((s: number, x: { confidence?: number }) => s + (x.confidence ?? 0), 0) / blocks.length
      : 0;
    return json(200, { text: full?.text ?? '', confidence: Math.round(conf * 100) });
  } catch {
    return json(500, { error: 'SERVER_ERROR' });
  }
});
