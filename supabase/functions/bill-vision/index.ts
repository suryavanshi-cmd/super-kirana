// bill-vision — turns a photo of a shopping list or bill into ready bill lines in ~2–3 seconds.
//
// One request to Google Gemini (vision) with the photo and the shop's own item list (names, units,
// prices). Gemini returns structured JSON (a fixed schema), which is then checked here:
// - only items from THIS shop's list can be linked; anything else stays an unlinked line;
// - the shop's own price is used for linked items (the price on paper is shown only as a hint);
// - numbers are validated and anything doubtful is flagged for the shopkeeper.
// Nothing is saved: the lines go into the bill on the phone, which the shopkeeper confirms as usual.
//
// Privacy: the photo is held in memory for this request only; it is never stored or logged. No
// customer names, mobiles or balances are sent to Google. Key: GEMINI_API_KEY secret or Vault.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const ENV_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
// Fast first; the next models are tried only if one is unavailable or overloaded.
const MODELS = (Deno.env.get('GEMINI_VISION_MODEL') ?? 'gemini-2.5-flash,gemini-flash-latest,gemini-2.5-flash-lite,gemini-flash-lite-latest').split(',').map((s) => s.trim()).filter(Boolean);
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Gemini's own reason, short and without the key, e.g. "429 RESOURCE_EXHAUSTED: Quota exceeded …". */
function geminiReason(model: string, status: number, body: string): string {
  let msg = body;
  try { const j = JSON.parse(body) as { error?: { status?: string; message?: string } }; if (j.error) msg = `${j.error.status ?? ''}: ${j.error.message ?? ''}`; } catch { /* plain text */ }
  return `${model} ${status} ${msg}`.replace(/AIza[0-9A-Za-z_-]+/g, '[key]').replace(/\s+/g, ' ').slice(0, 220);
}

const UNITS = ['kg', 'g', 'litre', 'ml', 'packet', 'piece', 'dozen'] as const;
type Unit = (typeof UNITS)[number];
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

interface CatItem { id: string; name: string; name_mr: string | null; name_en: string | null; unit: Unit; price: number }
interface AiItem { text?: string; name?: string; product?: number | null; qty?: number | null; unit?: string | null; rate?: number | null; amount?: number | null; sure?: boolean }
interface AiOut { items?: AiItem[]; total?: number | null }

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING', description: 'the line exactly as written' },
          name: { type: 'STRING', description: 'item name, cleaned, in the language written' },
          product: { type: 'INTEGER', nullable: true, description: 'number of the matching shop item, or null' },
          qty: { type: 'NUMBER', nullable: true },
          unit: { type: 'STRING', enum: [...UNITS], nullable: true },
          rate: { type: 'NUMBER', nullable: true, description: 'price per unit in rupees if written' },
          amount: { type: 'NUMBER', nullable: true, description: 'line amount in rupees if written' },
          sure: { type: 'BOOLEAN', description: 'false if any part was hard to read or the match is a guess' },
        },
        required: ['text', 'name', 'sure'],
      },
    },
    total: { type: 'NUMBER', nullable: true, description: 'grand total if written' },
  },
  required: ['items'],
};

// Exact unit ratios (same as the database).
function ratio(from: Unit, to: Unit): [number, number] | null {
  if (from === to) return [1, 1];
  const pairs: Record<string, [number, number]> = { 'g>kg': [1, 1000], 'kg>g': [1000, 1], 'ml>litre': [1, 1000], 'litre>ml': [1000, 1], 'piece>dozen': [1, 12], 'dozen>piece': [12, 1] };
  return pairs[`${from}>${to}`] ?? null;
}
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000);
const paise = (r: number | null | undefined) => (typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 10_000_000 ? Math.round(r * 100) : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const started = Date.now();
  try {
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const b = (await req.json().catch(() => ({}))) as { shop_id?: string; image_base64?: string; mime?: string; probe?: boolean };
    const { data: ctx, error } = await user.rpc('my_context');
    if (error || !ctx) return json(401, { error: 'NOT_AUTHENTICATED' });
    if (!(ctx.shops as { id: string }[]).some((s) => s.id === b.shop_id)) return json(403, { error: 'FORBIDDEN' });
    const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const key = await aiKey(svc);
    if (!key) return json(503, { error: 'NOT_CONFIGURED', detail: 'GEMINI_API_KEY is not set (Supabase secret or Vault gemini_api_key)' });
    if (b.probe) return json(200, { configured: true });

    const { data: allowed } = await svc.rpc('svc_rate_limit', { p_key: `vision:${ctx.user_id}`, p_max: 300, p_window_seconds: 3600 });
    if (!allowed) return json(429, { error: 'TOO_MANY_ATTEMPTS' });
    // Demo shop: each AI call uses one of the day's demo actions (real shops: always true).
    const { data: demoOk } = await svc.rpc('svc_demo_charge', { p_shop_id: b.shop_id });
    if (demoOk === false) return json(429, { error: 'DEMO_LIMIT' });
    const image = typeof b.image_base64 === 'string' ? b.image_base64 : '';
    if (!image || image.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return json(400, { error: 'IMAGE_TOO_LARGE' });
    const mime = b.mime === 'image/png' ? 'image/png' : b.mime === 'image/webp' ? 'image/webp' : 'image/jpeg';

    const { data: catData } = await svc.rpc('svc_bill_catalogue', { p_shop_id: b.shop_id });
    const cat = (Array.isArray(catData) ? catData : []) as CatItem[];
    const list = cat.map((p, i) => `${i + 1}|${p.name}${p.name_mr && p.name_mr !== p.name ? ` / ${p.name_mr}` : ''}${p.name_en && p.name_en !== p.name ? ` / ${p.name_en}` : ''}|${p.unit}`).join('\n');

    const prompt = [
      'You read photos of grocery lists and bills from a kirana shop in Maharashtra, India. Writing may be Marathi, Hindi or English, handwritten or printed, possibly mixed, with Devanagari or Latin digits.',
      'Return one entry per item line, in the order written. Ignore headings, dates, phone numbers, shop names, signatures and the grand-total line (put the grand total in "total").',
      'For each item: qty and unit as written (kg, g, litre, ml, packet, piece, dozen; "पाव" = 0.25 kg, "अर्धा" = 0.5, "दीड" = 1.5, "अडीच" = 2.5; a bare count means piece or packet).',
      'rate = price per unit only if written; amount = line amount only if written. Never invent prices.',
      'product = the number of the matching item from the SHOP ITEMS list below when it is clearly the same thing (consider Marathi/English names and brands; for loose staples like साखर, तूर डाळ, शेंगदाणे prefer the loose item). Use null if there is no clear match.',
      'Set sure=false if the text was hard to read, the quantity is unclear, or the match is a guess.',
      `SHOP ITEMS (number|name|unit):\n${list || '(none)'}`,
    ].join('\n');

    let out: AiOut | null = null, modelUsed = '', busy = false;
    const reasons: string[] = [];
    for (const model of MODELS) {
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: image } }, { text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 4096,
          ...(model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      };
      let res: Response;
      try {
        res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(25_000),
      });
      } catch (e) {   // this model timed out or could not be reached: try the next one
        reasons.push(`${model}: ${e instanceof Error ? e.name : 'fetch failed'}`);
        continue;
      }

      if (!res.ok) {   // note why (no image, no key) and try the next model
        const why = geminiReason(model, res.status, await res.text().catch(() => ''));
        console.error('gemini', why);
        reasons.push(why);
        if (res.status === 429) busy = true;
        continue;
      }
      const raw = await res.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const text = (raw.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      try { out = JSON.parse(text) as AiOut; modelUsed = model; break; } catch { reasons.push(`${model}: reply was not valid JSON`); continue; }
    }
    if (!out) return json(busy ? 429 : 502, { error: busy ? 'AI_BUSY' : 'AI_PROVIDER_ERROR', step: 'gemini', detail: reasons.join(' | ').slice(0, 450) || 'no model gave an answer' });

    const lines = (out.items ?? []).slice(0, 150).map((it) => {
      const flags: string[] = [];
      const p = Number.isInteger(it.product) && (it.product as number) >= 1 && (it.product as number) <= cat.length ? cat[(it.product as number) - 1] : null;
      let unit: Unit | null = it.unit && (UNITS as readonly string[]).includes(it.unit) ? it.unit as Unit : null;
      let qty = typeof it.qty === 'number' && it.qty > 0 && it.qty <= 100000 ? it.qty : null;
      if (qty === null) { qty = 1; flags.push('qty'); }
      const written = paise(it.rate);
      const amount = paise(it.amount);
      let priceUnit: Unit;
      let price: number | null;
      if (p) {
        if (!unit || !ratio(unit, p.unit)) { if (unit && unit !== p.unit) flags.push('unit'); unit = p.unit; }
        priceUnit = p.unit;
        price = p.price;                                   // the shop's own price
        if (written !== null && written !== p.price) flags.push('paper_price');
      } else {
        unit = unit ?? 'piece';
        priceUnit = unit;
        price = written;
        if (price === null && amount !== null && qty > 0) {
          const per = amount / qty;
          if (Number.isInteger(per)) price = per; else flags.push('price');
        }
        if (price === null) flags.push('price');
        flags.push('unmatched');
      }
      if (it.sure === false) flags.push('check');
      const name = (p ? p.name : (it.name ?? it.text ?? '').trim()).slice(0, 120);
      return { product_id: p?.id ?? null, name: name || '?', heard: (it.text ?? '').slice(0, 200), qty: qtyText(qty), unit, price_unit: priceUnit,
        price_paise: price, paper_price_paise: written, flags: [...new Set(flags)] };
    }).filter((l) => l.name !== '?');

    return json(200, { lines, total_paise: paise(out.total ?? null), model: modelUsed, ms: Date.now() - started });
  } catch (e) {
    const why = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('bill-vision failed', why);
    return json(502, { error: 'AI_PROVIDER_ERROR', step: 'internal', detail: why.replace(/AIza[0-9A-Za-z_-]+/g, '[key]').slice(0, 300) });
  }
});
