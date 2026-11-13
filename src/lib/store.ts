'use client';
// Shop accounts: inventory, stock-in, insights and the daily summary (owner-only screens).
import { useEffect, useState } from 'react';
import { AppError, callFunction, rpc } from './api';
import type { DayTotals } from './api';
import { useQuery, type Query } from './data';
import type { Unit } from './money';
import { formatPaise } from './money';
import { useShop } from './session';

export interface InventoryRow {
  id: string; name: string; name_en: string | null; name_mr: string | null; unit: Unit;
  default_price_paise: number; purchase_cost_paise: number | null; category: string | null; is_active: boolean;
  catalog_ref: string | null; reorder_level: number | string | null; stock: number | string | null; sold_7d: number | string; last_in_at: string | null;
}
export interface StockEntry { id: string; kind: 'purchase' | 'count'; qty: number | string; cost_paise: number | null; supplier: string | null; note: string | null; business_date: string; created_at: string }
export interface ProductStock extends Omit<InventoryRow, 'sold_7d' | 'last_in_at'> {
  sold_today: number | string; sold_7d: number | string; sold_30d: number | string; entries: StockEntry[];
}
export interface Insights {
  from: string; to: string; today: string; totals: DayTotals;
  customers: { customer_id: string | null; name: string | null; amount_paise: number; bills: number; due_paise: number }[];
  products: { product_id: string | null; name: string; unit: Unit; qty: number | string; amount_paise: number; bills: number; linked: boolean }[];
  days: { date: string; sales_paise: number; bills: number; collected_paise: number }[];
  dues: { total_paise: number; customers: number; top: { customer_id: string; name: string; due_paise: number }[] };
  low_stock: { product_id: string; name: string; unit: Unit; stock: number | string; reorder_level: number | string | null }[];
}

export function useInventory(): Query<InventoryRow[]> {
  const { shop, scope } = useShop();
  return useQuery(() => rpc<InventoryRow[]>('list_inventory', { p_shop_id: shop.id }), [shop.id], `${scope}inventory`);
}

export function useInsights(from: string, to: string): Query<Insights> {
  const { shop } = useShop();
  return useQuery(() => rpc<Insights>('get_insights', { p_shop_id: shop.id, p_from: from, p_to: to }), [shop.id, from, to]);
}

/** A quantity like 12.5 shown without needless zeros: "12.5", "3", "0.25". */
export function fmtQty(q: number | string | null | undefined): string {
  if (q === null || q === undefined || q === '') return '—';
  const n = Number(q);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}
export const num = (q: number | string | null | undefined): number | null => (q === null || q === undefined || q === '' ? null : Number(q));
export const isLow = (r: { stock: number | string | null; reorder_level: number | string | null }) => {
  const s = num(r.stock);
  return s !== null && s <= (num(r.reorder_level) ?? 0);
};
export const rupeesShort = (paise: number) => formatPaise(paise).replace(/\.00$/, '');

// ------------------------------------------------------------------ ready-made catalogue
export interface CatalogItem { ref: string; name_mr: string; name_en: string; category: string; unit: Unit; price_paise: number; brand: string; search: string }

let catalogPromise: Promise<CatalogItem[]> | null = null;
export function loadCatalog(): Promise<CatalogItem[]> {
  catalogPromise ??= fetch('/catalog/v1.json', { cache: 'force-cache' })
    .then((r) => { if (!r.ok) throw new AppError('NETWORK', 'network'); return r.json(); })
    .then((d: { items: [string, string, string, string, Unit, number, string][] }) => d.items.map(([ref, name_mr, name_en, category, unit, price_paise, brand]) => (
      { ref, name_mr, name_en, category, unit, price_paise, brand, search: `${name_mr} ${name_en} ${brand}`.toLowerCase() })))
    .catch((e) => { catalogPromise = null; throw e; });
  return catalogPromise;
}
export function useCatalog(): { items: CatalogItem[] | null; error: AppError | null; retry: () => void } {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    loadCatalog().then((x) => { if (live) setItems(x); }).catch((e) => { if (live) setError(e instanceof AppError ? e : new AppError('NETWORK', 'network')); });
    return () => { live = false; };
  }, [n]);
  return { items, error, retry: () => setN((x) => x + 1) };
}

/** Plain substring search first (fast); fall back to sound-alike matching for Latin ↔ Devanagari. */
export function searchCatalog(items: CatalogItem[], q: string, category: string | null, soundsLike: (q: string, f: string) => boolean): CatalogItem[] {
  const query = q.normalize('NFC').toLowerCase().trim();
  const inCat = category ? items.filter((i) => i.category === category) : items;
  if (!query) return inCat;
  const words = query.split(/\s+/);
  const direct = inCat.filter((i) => words.every((w) => i.search.includes(w)));
  if (direct.length >= 5 || query.length < 3) return direct;
  const seen = new Set(direct.map((i) => i.ref));
  return direct.concat(inCat.filter((i) => !seen.has(i.ref) && soundsLike(query, i.name_mr)));
}

// ------------------------------------------------------------------ AI summary (optional)
export async function aiSummary(body: Record<string, unknown>): Promise<{ text: string } | { error: string; err?: AppError }> {
  try {
    const out = await callFunction<{ text?: string }>('ai-summary', body, 45_000);
    return { text: out.text ?? '' };
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError('UNKNOWN', 'server', String(e), 'ai-summary');
    return { error: err.code, err };
  }
}
