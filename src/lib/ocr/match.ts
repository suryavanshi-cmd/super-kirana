import type { Product } from '../api';
import { unitRatio } from '../money';
import type { DraftItem } from './types';

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

function editDistance(a: string, b: string): number {
  const A = [...a], B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[B.length];
}

/** 0..1 similarity between recognised text and one catalogue name. */
export function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const len = Math.max([...x].length, [...y].length);
  return 1 - editDistance(x, y) / len;
}

export interface Match { product: Product; score: number }

export function matchProducts(name: string, products: Product[], limit = 3): Match[] {
  return products.filter((p) => p.is_active)
    .map((p) => ({ product: p, score: Math.max(similarity(name, p.name), similarity(name, p.name_mr ?? ''), similarity(name, p.name_en ?? '')) }))
    .filter((m) => m.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Links a draft line to the catalogue. A missing price is filled with the saved price only as a
 * SUGGESTION (flag `price_from_catalogue`) that the shopkeeper must accept or edit.
 */
export function applyCatalogue(item: DraftItem, products: Product[]): DraftItem {
  const best = matchProducts(item.name, products, 1)[0];
  const flags = new Set(item.flags);
  flags.delete('unmatched'); flags.delete('price_from_catalogue');
  if (!best) { flags.add('unmatched'); return { ...item, productId: null, flags: [...flags] }; }
  const next: DraftItem = { ...item, productId: best.product.id };
  if (!next.unit) { next.unit = best.product.unit; next.priceUnit = best.product.unit; flags.delete('unit_missing'); }
  // Suggest the saved price only when the written unit can be priced at the catalogue unit
  // (500 g against a per-kg rate is fine; packets against a per-kg rate is not).
  if (next.unitPricePaise === null && next.ambiguousAmountPaise === null && unitRatio(next.unit, best.product.unit)) {
    next.unitPricePaise = best.product.default_price_paise;
    next.priceUnit = best.product.unit;
    flags.delete('price_missing'); flags.add('price_from_catalogue');
  }
  return { ...next, flags: [...flags] };
}
