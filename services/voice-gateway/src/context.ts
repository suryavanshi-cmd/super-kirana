// Shop context (customers, items, Sarvam keyterms): in-memory per instance, keyed by shop, TTL 10 min.
// One Supabase call per miss: svc_voice_context(user, shop), which also re-checks shop membership.
import { Agent, fetch } from 'undici';
import { config } from './config';
import { E, GatewayError } from './errors';
import { indexCustomers, type IndexedCustomer } from './parser/match';
import { indexItems, type ShopItem } from './parser/parse';
import { isDevanagari, romanise } from './parser/text';

export interface ShopContext { shopId: string; at: number; customers: IndexedCustomer[]; items: ShopItem[]; keyterms: string[] }
interface Raw { shop_id: string; customers: { id: string; name: string }[]; items: string[] }

const agent = new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 300_000, connections: 8 });
const shops = new Map<string, ShopContext>();                     // shop_id → context
const members = new Map<string, { shopId: string; at: number }>(); // user|requested shop → resolved shop
const MAX_SHOPS = 500;
let fetchImpl: typeof fetch = fetch;
/** Test hook: replace the Supabase call. */
export function setContextFetch(f: typeof fetch | null) { fetchImpl = f ?? fetch; }

// Words every entry uses, so Sarvam spells them the way the parser expects.
const FIXED_TERMS = ['रुपये', 'घेतले', 'दिले', 'जमा', 'उधार', 'बाकी', 'नेले', 'भरले', 'शे', 'हजार'];
const COMMON_ITEMS = ['साखर', 'तेल', 'डाळ', 'तांदूळ', 'गहू', 'पीठ', 'चहा', 'साबण', 'दूध', 'बिस्कीट', 'कांदे', 'बटाटे'];

/** ≤ 50 terms, each ≤ 64 chars: actions + common items + customers by recent activity (both scripts). */
export function buildKeyterms(customers: { name: string }[]): string[] {
  const out: string[] = [];
  const add = (t: string) => { const s = t.trim().slice(0, 64); if (s && !out.includes(s) && out.length < 50) out.push(s); };
  FIXED_TERMS.forEach(add);
  COMMON_ITEMS.forEach(add);
  for (const c of customers) {
    if (out.length >= 50) break;
    add(c.name);
    if (isDevanagari(c.name)) add(c.name.split(/\s+/).map(romanise).join(' '));
  }
  return out;
}

async function load(userId: string, shopId: string | null): Promise<ShopContext> {
  let res;
  try {
    res = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/svc_voice_context`, {
      method: 'POST', dispatcher: agent, signal: AbortSignal.timeout(4000),
      // New-style keys (sb_secret_…) go in "apikey" only; legacy service_role JWTs also as Bearer.
      headers: { apikey: config.serviceKey, ...(config.serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${config.serviceKey}` } : {}), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_shop_id: shopId }),
    });
  } catch (e) {
    throw E.context(e instanceof Error && e.name === 'TimeoutError' ? 'Supabase did not answer in 4s' : `network: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { const j = JSON.parse(text) as { message?: string; code?: string }; msg = j.message ?? msg; } catch { /* plain text */ }
    if (msg === 'FORBIDDEN' || msg === 'NOT_AUTHENTICATED') throw E.forbidden();
    if (msg === 'SHOP_REQUIRED') throw E.shopRequired();
    throw E.context(`Supabase ${res.status}: ${msg}`);
  }
  const raw = JSON.parse(text) as Raw;
  return {
    shopId: raw.shop_id, at: Date.now(),
    customers: indexCustomers(raw.customers ?? []),
    items: indexItems(raw.items ?? []),
    keyterms: buildKeyterms(raw.customers ?? []),
  };
}

/** Context for this user's shop. Membership is re-checked on every miss (at most every 10 minutes). */
export async function getContext(userId: string, requestedShop: string | null, opts: { maxAgeMs?: number } = {}): Promise<{ ctx: ShopContext; cached: boolean }> {
  const ttl = Math.min(opts.maxAgeMs ?? config.cacheTtlMs, config.cacheTtlMs);
  const mkey = `${userId}|${requestedShop ?? ''}`;
  const m = members.get(mkey);
  if (m && Date.now() - m.at < config.cacheTtlMs) {
    const hit = shops.get(m.shopId);
    if (hit && Date.now() - hit.at < ttl) return { ctx: hit, cached: true };
  }
  try {
    const ctx = await load(userId, requestedShop);
    if (shops.size >= MAX_SHOPS) shops.delete(shops.keys().next().value!);
    shops.set(ctx.shopId, ctx);
    members.set(mkey, { shopId: ctx.shopId, at: Date.now() });
    if (members.size > MAX_SHOPS * 4) members.delete(members.keys().next().value!);
    return { ctx, cached: false };
  } catch (e) {
    if (e instanceof GatewayError && (e.code === 'FORBIDDEN' || e.code === 'SHOP_REQUIRED')) members.delete(mkey);
    throw e;
  }
}

export function invalidate(shopId: string): boolean { return shops.delete(shopId); }
/** Test hook. */
export function clearContexts() { shops.clear(); members.clear(); }
export const cacheSize = () => shops.size;
/** Test hook. */
export function primeContext(userId: string, requestedShop: string | null, ctx: ShopContext) {
  shops.set(ctx.shopId, ctx);
  members.set(`${userId}|${requestedShop ?? ''}`, { shopId: ctx.shopId, at: Date.now() });
}
