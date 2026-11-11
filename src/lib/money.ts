// Money and quantity helpers. Money is always integer paise; nothing here uses floating-point
// arithmetic for an authoritative amount. The server recomputes every total — these functions
// only drive previews and input validation, and mirror app_private.line_gross() exactly.

export const MAX_PAISE = 100_000_000_000; // ₹100 crore
export const MAX_UNIT_PRICE_PAISE = 1_000_000_000;

export const UNITS = ['kg', 'g', 'litre', 'ml', 'packet', 'piece', 'dozen'] as const;
export type Unit = (typeof UNITS)[number];

export type ParseError = 'empty' | 'malformed' | 'negative' | 'too_precise' | 'out_of_range';
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ParseError };

const DEVANAGARI_ZERO = 0x0966;

/** Devanagari digits → ASCII, trims, removes grouping commas, the ₹ sign and spaces. */
export function normalizeNumberText(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp >= DEVANAGARI_ZERO && cp <= DEVANAGARI_ZERO + 9) out += String(cp - DEVANAGARI_ZERO);
    else out += ch;
  }
  return out.replace(/[₹,\s]/g, '');
}

/** "315", "315.5", "1,250.75", "३१५" → paise. Rejects negatives, >2 decimals, junk, out-of-range. */
export function parseRupees(input: string, opts: { allowZero?: boolean } = {}): Parsed<number> {
  const t = normalizeNumberText(input ?? '');
  if (t === '') return { ok: false, error: 'empty' };
  if (t.startsWith('-')) return { ok: false, error: 'negative' };
  if (/^\d+\.\d{3,}$/.test(t)) return { ok: false, error: 'too_precise' };
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { ok: false, error: 'malformed' };
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(paise) || paise > MAX_PAISE) return { ok: false, error: 'out_of_range' };
  if (paise === 0 && !opts.allowZero) return { ok: false, error: 'out_of_range' };
  return { ok: true, value: paise };
}

/** Quantity text → thousandths (integer). "0.5" → 500, "1.250" → 1250. Max 3 decimals. */
export function parseQty(input: string): Parsed<number> {
  const t = normalizeNumberText(input ?? '');
  if (t === '') return { ok: false, error: 'empty' };
  if (t.startsWith('-')) return { ok: false, error: 'negative' };
  if (/^\d+\.\d{4,}$/.test(t)) return { ok: false, error: 'too_precise' };
  const m = /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) return { ok: false, error: 'malformed' };
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0') || '0');
  if (milli <= 0 || milli > 100_000_000) return { ok: false, error: 'out_of_range' };
  return { ok: true, value: milli };
}

/** Thousandths → canonical decimal text for the API ("1250" → "1.25"). */
export function qtyToText(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const frac = String(milli % 1000).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Exact ratio to convert a quantity in `from` into `to`; null when the units are unrelated. */
export function unitRatio(from: Unit, to: Unit): { num: bigint; den: bigint } | null {
  if (from === to) return { num: 1n, den: 1n };
  const key = `${from}>${to}`;
  const table: Record<string, [bigint, bigint]> = {
    'g>kg': [1n, 1000n], 'kg>g': [1000n, 1n],
    'ml>litre': [1n, 1000n], 'litre>ml': [1000n, 1n],
    'piece>dozen': [1n, 12n], 'dozen>piece': [12n, 1n],
  };
  const r = table[key];
  return r ? { num: r[0], den: r[1] } : null;
}

export function compatibleUnits(unit: Unit): Unit[] {
  return UNITS.filter((u) => unitRatio(u, unit) !== null);
}

/** qty × unit price → paise, rounded half-up to the paisa. Integer (BigInt) arithmetic only. */
export function lineGrossPaise(qtyMilli: number, unit: Unit, priceUnit: Unit, unitPricePaise: number): number | null {
  const r = unitRatio(unit, priceUnit);
  if (!r) return null;
  const n = BigInt(qtyMilli) * r.num * BigInt(unitPricePaise);
  const d = r.den * 1000n;
  return Number((2n * n + d) / (2n * d));
}

/** Indian digit grouping with exactly two decimals: 12345678 → "1,23,456.78". */
export function formatPaisePlain(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = String(Math.trunc(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  let head = rupees.length > 3 ? rupees.slice(0, -3) : '';
  const tail = rupees.slice(-3);
  const groups: string[] = [];
  while (head.length > 2) { groups.unshift(head.slice(-2)); head = head.slice(0, -2); }
  if (head) groups.unshift(head);
  return `${neg ? '-' : ''}${[...groups, tail].join(',')}.${frac}`;
}

/** Same string in every interface language: switching language can never change an amount. */
export function formatPaise(paise: number): string {
  return `₹${formatPaisePlain(paise)}`;
}

export function paiseToInputText(paise: number): string {
  const s = formatPaisePlain(paise).replace(/,/g, '');
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}
