// ai-summary — writes a short, friendly business summary for a shop owner with Google Gemini (free tier).
//
// Security and privacy:
// - Only the shop's owner can use it: the numbers come from get_insights, called with the caller's own
//   token, which re-checks the role inside the database.
// - The Gemini key is read on the server only: the GEMINI_API_KEY function secret if set, otherwise the
//   encrypted Supabase Vault secret `gemini_api_key` (via svc_ai_key, callable by service_role only).
// - Customer names and mobile numbers are NEVER sent to the AI provider. Customers are sent as
//   "C1", "C2", … and the real names are put back only in the reply returned to the owner.
// - The AI only rewrites numbers it is given; the app also shows the exact figures next to it.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const ENV_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const MODELS = (Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-latest,gemini-2.5-flash,gemini-2.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean);
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
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

const rupees = (paise: number) => {
  const r = Math.round(Number(paise) / 100);
  const s = String(Math.abs(r));
  const head = s.slice(0, -3), tail = s.slice(-3);
  return `${r < 0 ? '-' : ''}₹${head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : ''}${tail}`;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Insights {
  from: string; to: string;
  totals: Record<string, number>;
  customers: { name: string | null; amount_paise: number; bills: number }[];
  products: { name: string; unit: string; qty: number; amount_paise: number; linked: boolean }[];
  days: { date: string; sales_paise: number; collected_paise: number; bills: number }[];
  dues: { total_paise: number; customers: number; top: { name: string; due_paise: number }[] };
  low_stock: { name: string; unit: string; stock: number }[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const auth = req.headers.get('authorization') ?? '';
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const b = (await req.json().catch(() => ({}))) as { shop_id?: string; from?: string; to?: string; language?: string; probe?: boolean };
    const { data: ctx, error } = await user.rpc('my_context');
    if (error || !ctx) return json(401, { error: 'NOT_AUTHENTICATED' });
    const shop = (ctx.shops as { id: string; role: string; name_mr?: string }[]).find((s) => s.id === b.shop_id);
    if (!shop) return json(403, { error: 'FORBIDDEN' });
    if (shop.role !== 'owner') return json(403, { error: 'OWNER_ONLY' });

    const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const key = await aiKey(svc);
    if (!key) return json(503, { error: 'NOT_CONFIGURED' });
    if (b.probe) return json(200, { configured: true });

    const { data: allowed } = await svc.rpc('svc_rate_limit', { p_key: `ai:${ctx.user_id}`, p_max: 30, p_window_seconds: 3600 });
    if (!allowed) return json(429, { error: 'TOO_MANY_ATTEMPTS' });

    if (!b.from || !b.to || !DATE.test(b.from) || !DATE.test(b.to)) return json(400, { error: 'INVALID_RANGE' });
    const { data: ins, error: insErr } = await user.rpc('get_insights', { p_shop_id: b.shop_id, p_from: b.from, p_to: b.to });
    if (insErr || !ins) return json(400, { error: insErr?.message ?? 'INVALID_RANGE' });
    const d = ins as Insights;

    // Customers are replaced by codes before anything leaves our servers.
    const names = new Map<string, string>();
    const code = (name: string | null) => {
      const n = name ?? '';
      if (!n) return 'walk-in';
      if (!names.has(n)) names.set(n, `C${names.size + 1}`);
      return names.get(n)!;
    };
    const t = d.totals;
    const facts = {
      period: b.from === b.to ? `day ${b.from}` : `${b.from} to ${b.to}`,
      sales: rupees(t.net_sales_paise ?? 0), bills: t.bills ?? 0, collected: rupees(t.net_collections_paise ?? 0),
      cash: rupees(t.cash_paise ?? 0), upi: rupees(t.upi_paise ?? 0),
      total_credit_pending: rupees(d.dues.total_paise), customers_with_dues: d.dues.customers,
      top_buyers: d.customers.slice(0, 5).map((c) => ({ customer: code(c.name), bought: rupees(c.amount_paise), bills: c.bills })),
      biggest_dues: d.dues.top.slice(0, 5).map((c) => ({ customer: code(c.name), due: rupees(c.due_paise) })),
      top_products: d.products.slice(0, 8).map((p) => ({ item: p.name, qty: `${p.qty} ${p.unit}`, amount: rupees(p.amount_paise) })),
      best_day: d.days.length > 1 ? (() => { const x = [...d.days].sort((a, c) => c.sales_paise - a.sales_paise)[0]; return x ? { date: x.date, sales: rupees(x.sales_paise) } : null; })() : null,
      low_stock: d.low_stock.slice(0, 8).map((p) => `${p.name} (${p.stock} ${p.unit})`),
    };
    const lang = b.language === 'en' ? 'simple English' : 'simple Marathi (Devanagari script)';
    const prompt = [
      `You help a small kirana (grocery) shop owner in Maharashtra, India. Write a short summary of the shop's business in ${lang}.`,
      'Rules: use ONLY the facts below, never invent or calculate new numbers; keep every ₹ amount exactly as written;',
      'keep customer codes like C1, C2 exactly as written (do not translate or change them);',
      'write 5 to 8 short bullet lines starting with "• ", then one line of practical advice (for example whom to remind about dues, or what to restock).',
      'No headings, no markdown symbols other than the bullets, under 140 words.',
      `Facts (JSON): ${JSON.stringify(facts)}`,
    ].join('\n');

    let text = '';
    for (const model of MODELS) {
      const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) { await res.body?.cancel(); continue; }       // model name retired: try the next one
      if (res.status === 429) { await res.body?.cancel(); return json(429, { error: 'AI_BUSY' }); }
      if (!res.ok) { await res.body?.cancel(); return json(502, { error: 'AI_PROVIDER_ERROR' }); }
      const out = await res.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      text = (out.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
      break;
    }
    if (!text) return json(502, { error: 'AI_PROVIDER_ERROR' });

    // Put the real names back (longest codes first so C12 is not read as C1).
    const back = [...names.entries()].sort((a, c) => c[1].length - a[1].length);
    for (const [name, c] of back) text = text.replace(new RegExp(`\\b${c}\\b`, 'g'), name);
    text = text.replace(/[<>]/g, '').replace(/\*\*/g, '').slice(0, 2000);
    return json(200, { text, source: 'ai' });
  } catch {
    return json(502, { error: 'AI_PROVIDER_ERROR' });
  }
});
