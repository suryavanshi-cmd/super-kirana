// The unfinished bill. It lives only on this device (IndexedDB) until the shopkeeper confirms it;
// a draft is never shown as a saved bill and never produces a receipt.
import type { Method, Product } from './api';
import { idbDel, idbGet, idbSet } from './idb';
import { lineGrossPaise, paiseToInputText, parseQty, parseRupees, qtyToText, type Unit } from './money';

export interface Line {
  id: string; productId: string | null; name: string; qty: string; unit: Unit; priceUnit: Unit; price: string; discount: string; fromOcr?: boolean;
  flags?: string[];          // photo reader: things for the shopkeeper to check (cleared when the line is edited)
  heard?: string;            // photo reader: the line as written on paper
  paperPrice?: number;       // photo reader: price written on paper, when different from the shop price
  priceVia?: 'typed' | 'voice' | 'photo';   // how the rate on this line was last set
}
/** One change made to the open bill (by typing, mic or photo), shown in the bill's change history. */
export interface Change { at: number; how: 'typed' | 'voice' | 'photo'; text: string }
export interface Draft {
  customerId: string | null; customerName: string | null; lines: Line[];
  paid: string; paidTouched: boolean; method: Method; reference: string; note: string;
  source: 'manual' | 'ocr'; ocrJobId: string | null; updatedAt: number;
  changes?: Change[];
  paperTotal?: number | null; // grand total written on the photographed paper, for a cross-check
}
export const emptyDraft = (): Draft => ({ customerId: null, customerName: null, lines: [], paid: '', paidTouched: false, method: 'cash', reference: '', note: '', source: 'manual', ocrJobId: null, updatedAt: Date.now() });

const key = (scope: string) => `${scope}bill`;
export const loadDraft = async (scope: string): Promise<Draft> => (await idbGet<Draft>('drafts', key(scope))) ?? emptyDraft();
export const saveDraft = (scope: string, d: Draft): Promise<boolean> => idbSet('drafts', key(scope), { ...d, updatedAt: Date.now() });
export const clearDraft = (scope: string): Promise<boolean> => idbDel('drafts', key(scope));

let n = 0;
export const lineId = (): string => `l${Date.now().toString(36)}${(++n).toString(36)}`;

export function lineFromProduct(p: Product): Line {
  return { id: lineId(), productId: p.id, name: p.name, qty: '1', unit: p.unit, priceUnit: p.unit, price: paiseToInputText(p.default_price_paise), discount: '' };
}

export type LineError = 'name' | 'qty' | 'price' | 'unit' | 'discount';
export interface LineCalc { ok: boolean; error: LineError | null; qtyMilli: number; pricePaise: number; discountPaise: number; grossPaise: number; totalPaise: number }

/** Preview of one line — the same integer arithmetic the server uses. The server's result is final. */
export function calcLine(l: Line): LineCalc {
  const bad = (error: LineError): LineCalc => ({ ok: false, error, qtyMilli: 0, pricePaise: 0, discountPaise: 0, grossPaise: 0, totalPaise: 0 });
  if (!l.name.trim()) return bad('name');
  const q = parseQty(l.qty);
  if (!q.ok) return bad('qty');
  const p = parseRupees(l.price, { allowZero: true });
  if (!p.ok || p.value > 1_000_000_000) return bad('price');
  const gross = lineGrossPaise(q.value, l.unit, l.priceUnit, p.value);
  if (gross === null) return bad('unit');
  let discount = 0;
  if (l.discount.trim()) {
    const d = parseRupees(l.discount, { allowZero: true });
    if (!d.ok || d.value > gross) return bad('discount');
    discount = d.value;
  }
  return { ok: true, error: null, qtyMilli: q.value, pricePaise: p.value, discountPaise: discount, grossPaise: gross, totalPaise: gross - discount };
}

export interface BillCalc { ok: boolean; lines: LineCalc[]; totalPaise: number; paidPaise: number | null; billPaidPaise: number; oldDuesPaidPaise: number; billDuePaise: number; newBalancePaise: number; problem: 'empty' | 'lines' | 'total' | 'paid' | 'walkin' | 'overpay' | null }

/** Totals + payment split for the confirmation screen. `previousPaise` is the customer's dues now. */
export function calcBill(d: Draft, previousPaise: number): BillCalc {
  const lines = d.lines.map(calcLine);
  const total = lines.reduce((s, l) => s + l.totalPaise, 0);
  const base: BillCalc = { ok: false, lines, totalPaise: total, paidPaise: null, billPaidPaise: 0, oldDuesPaidPaise: 0, billDuePaise: total, newBalancePaise: previousPaise + total, problem: null };
  if (d.lines.length === 0) return { ...base, problem: 'empty' };
  if (lines.some((l) => !l.ok)) return { ...base, problem: 'lines' };
  if (total <= 0) return { ...base, problem: 'total' };
  const walkIn = d.customerId === null;
  const paidText = walkIn && !d.paidTouched ? paiseToInputText(total) : d.paid;
  const p = parseRupees(paidText, { allowZero: true });
  if (!p.ok) return { ...base, problem: 'paid' };
  const paid = p.value;
  const billPaid = Math.min(paid, total);
  const out: BillCalc = { ...base, paidPaise: paid, billPaidPaise: billPaid, oldDuesPaidPaise: paid - billPaid, billDuePaise: total - billPaid, newBalancePaise: previousPaise + total - paid };
  if (walkIn && paid !== total) return { ...out, problem: 'walkin' };
  if (!walkIn && paid > total + previousPaise) return { ...out, problem: 'overpay' };
  return { ...out, ok: true };
}

/** The exact request body for create_invoice. Totals are NOT sent: the server computes them. */
export function invoiceItems(d: Draft, calc: BillCalc): Record<string, unknown>[] {
  return d.lines.map((l, i) => ({
    product_id: l.productId, name: l.name.trim(), qty: qtyToText(calc.lines[i].qtyMilli), unit: l.unit, price_unit: l.priceUnit,
    unit_price_paise: calc.lines[i].pricePaise, discount_paise: calc.lines[i].discountPaise,
  }));
}
