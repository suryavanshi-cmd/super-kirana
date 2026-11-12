// Turns recognised text into draft bill lines. Deterministic and conservative:
//  * a price is taken only when it is written on the line (or later suggested from the catalogue);
//  * when a number could be either the rate or the line total, the line is flagged, not guessed;
//  * nothing here ever posts anything.
import { lineGrossPaise, parseQty, parseRupees, unitRatio, type Unit } from '../money';
import type { DraftItem, Flag } from './types';

const UNIT_WORDS: [RegExp, Unit][] = [
  [/^(kg|kgs|kilo|kilos|kilogram|किलो|कीलो|कि\.?|केजी|किलोग्रॅम|किग्रॅ|कि\.ग्रॅ\.?)$/i, 'kg'],
  [/^(g|gm|gms|grm|gram|grams|ग्रॅम|ग्राम|ग्रॅ\.?|ग्रा\.?|ग्रम)$/i, 'g'],
  [/^(l|lt|ltr|ltrs|lit|litre|liter|litres|liters|लिटर|लीटर|ली\.?|लि\.?)$/i, 'litre'],
  [/^(ml|mls|मिली|मि\.?ली\.?|एमएल)$/i, 'ml'],
  [/^(pkt|pkts|pack|packs|packet|packets|पाकीट|पाकिट|पॅकेट|पॅक|पुडा|पुडे|पुडी)$/i, 'packet'],
  [/^(pc|pcs|piece|pieces|nos|no|नग|नंग)$/i, 'piece'],
  [/^(dz|doz|dozen|डझन)$/i, 'dozen'],
];
const FRACTION_WORDS: Record<string, string> = {
  'पाव': '0.25', 'अर्धा': '0.5', 'अर्धी': '0.5', 'अर्धे': '0.5', 'आधा': '0.5', 'पाऊण': '0.75', 'सव्वा': '1.25', 'दीड': '1.5', 'अडीच': '2.5',
  'half': '0.5', 'quarter': '0.25',
  'एक': '1', 'दोन': '2', 'तीन': '3', 'चार': '4', 'पाच': '5', 'सहा': '6', 'सात': '7', 'आठ': '8', 'नऊ': '9', 'दहा': '10',
  'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
};
const VULGAR: Record<string, string> = { '½': '.5', '¼': '.25', '¾': '.75' };

/** Common OCR misreads inside numbers: O→0, l/I/|→1 (only in tokens that already contain a digit). */
function fixDigits(s: string): string {
  return s
    .replace(/(?<![\p{L}])[0-9OoIl|]*[0-9][0-9OoIl|]*(?:[.,][0-9OoIl|]+)?(?![\p{L}])/gu, (m) => m.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1'))
    .replace(/(?<![\p{L}\d])[Il|](?=\s*(?:kg|kgs|g|gm|ltr|lt|litre|liter|ml|pkt|pcs|dozen|किलो|लिटर|ग्रॅम|पाकीट|नग|डझन)(?![\p{L}]))/giu, '1');
}

/** "1/2" → 0.5, "1 1/2" or "1½" → 1.5 (halves, quarters and three-quarters only). */
function fixFractions(s: string): string {
  return s
    .replace(/(\d*)\s*([½¼¾])/g, (_, w: string, f: string) => `${w || '0'}${VULGAR[f]}`)
    .replace(/(?:(\d+)\s+)?\b([13])\s*\/\s*([24])\b(?!\s*-)/g, (m, w: string | undefined, n: string, d: string) => {
      if (n === '3' && d === '2') return m;
      const v = Number(n) / Number(d) + (w ? Number(w) : 0);
      return String(v);
    });
}
const RATE_HINT = /^(@|x|×|\*|दर|rate|प्रति)$/i;
const NUM = /^\d+(?:\.\d+)?$/;

const unitOf = (w: string): Unit | null => UNIT_WORDS.find(([re]) => re.test(w))?.[1] ?? null;

function tokenize(line: string): string[] {
  let s = '';                                              // Devanagari digits -> ASCII, keeping spaces
  for (const ch of line) {
    const cp = ch.codePointAt(0)!;
    s += cp >= 0x0966 && cp <= 0x096f ? String(cp - 0x0966) : ch;
  }
  s = fixFractions(fixDigits(s));
  return s
    .replace(/^\s*(?:\d{1,2}[.)]|[-*•·])\s+/, '')          // list numbering / bullets
    .replace(/(\d),(\d{3})\b/g, '$1$2')                    // 1,250 -> 1250
    .replace(/(₹|रु\.?|rs\.?|inr)\s*/gi, ' ₹ ')
    .replace(/\/-/g, ' /- ')
    .replace(/\/(?!-)/g, ' / ')                            // 42/kg -> 42 / kg
    .replace(/([=@×*])/g, ' $1 ')
    .replace(/(\d)\s*[xX]\s*(\d)/g, '$1 x $2')
    .replace(/(\d)([^\d\s.])/g, '$1 $2')                   // 500gm -> 500 gm
    .replace(/([^\d\s.₹])(\d)/g, '$1 $2')                  // साखर2 -> साखर 2
    .split(/\s+/).filter(Boolean);
}

let counter = 0;

export function parseLine(raw: string, confidence: number | null = null): DraftItem | null {
  const text = raw.trim();
  if (!text || text.replace(/[\s\-_=.:|]/g, '').length < 2) return null;
  const tokens = tokenize(text);
  const used = new Array<boolean>(tokens.length).fill(false);
  let qtyText = '';
  let unit: Unit | null = null;

  // quantity + unit:  "2 kg" | "kg 2" | "अर्धा किलो" | bare unit ("किलो" = 1)
  for (let i = 0; i < tokens.length && !unit; i++) {
    const u = unitOf(tokens[i]);
    if (!u) continue;
    unit = u; used[i] = true;
    const prev = tokens[i - 1], next = tokens[i + 1];
    if (prev && NUM.test(prev) && !used[i - 1]) { qtyText = prev; used[i - 1] = true; }
    else if (prev && FRACTION_WORDS[prev.toLowerCase()]) { qtyText = FRACTION_WORDS[prev.toLowerCase()]; used[i - 1] = true; }
    else if (next && NUM.test(next) && !(tokens[i + 2] && unitOf(tokens[i + 2]))) { qtyText = next; used[i + 1] = true; }
  }
  if (!unit) {
    const f = tokens.findIndex((t) => FRACTION_WORDS[t.toLowerCase()]);
    if (f >= 0) { qtyText = FRACTION_WORDS[tokens[f].toLowerCase()]; used[f] = true; }
  }

  // money: numbers that are not the quantity, with the hints written next to them
  let rate: number | null = null, total: number | null = null;
  const loose: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (used[i] || !NUM.test(tokens[i])) continue;
    const p = parseRupees(tokens[i]);
    const prev = tokens[i - 1] ?? '', next = tokens[i + 1] ?? '';
    if (!p.ok) { continue; }
    const mark = (j: number) => { if (j >= 0 && j < tokens.length) used[j] = true; };
    if (prev === '=') { total = p.value; used[i] = true; mark(i - 1); }
    else if (RATE_HINT.test(prev)) { rate = p.value; used[i] = true; mark(i - 1); }
    else if (next === '/' && unitOf(tokens[i + 2] ?? '')) { rate = p.value; used[i] = true; mark(i + 1); mark(i + 2); }
    else if (prev === '₹' || next === '/-') { loose.push(p.value); used[i] = true; mark(prev === '₹' ? i - 1 : i + 1); }
    else if (!qtyText && !unit && loose.length === 0 && rate === null && total === null && /^\d{1,3}(\.\d{1,3})?$/.test(tokens[i])
             && tokens.slice(i + 1).some((t, k) => !used[i + 1 + k] && NUM.test(t))) {
      qtyText = tokens[i]; used[i] = true;      // "साखर 2 90" -> first small number is the quantity
    }
    else { loose.push(p.value); used[i] = true; }
  }
  for (let i = 0; i < tokens.length; i++) if (!used[i] && /^(₹|\/-|=|@|,|\/|x|×|\*)$/i.test(tokens[i])) used[i] = true;

  const flags: Flag[] = [];
  let ambiguous: number | null = null;
  if (rate === null && total !== null && loose.length === 1) { rate = loose.shift()!; }
  if (rate !== null && total === null && loose.length === 1) { total = loose.shift()!; }
  if (rate === null && total === null && loose.length === 2) { rate = loose[0]; total = loose[1]; loose.length = 0; }
  if (rate === null && total === null && loose.length === 1) {
    if (!qtyText && !unit && Number.isInteger(loose[0] / 100) && loose[0] <= 2000) {
      qtyText = String(loose[0] / 100);          // "बिस्किट 3": a lone small whole number is a count
    } else if (qtyText === '1' || !qtyText) { rate = loose[0]; }
    else { ambiguous = loose[0]; flags.push('ambiguous_amount'); }
    loose.length = 0;
  }
  if (loose.length > 0) flags.push('low_confidence');

  const name = tokens.filter((_, i) => !used[i]).join(' ').replace(/^[\s:.\-–]+|[\s:.\-–]+$/g, '').trim();
  if (!name) return null;
  if (!qtyText) flags.push('qty_missing');
  if (!unit) flags.push('unit_missing');
  if (rate === null && ambiguous === null) flags.push('price_missing');
  if (rate !== null && total !== null && qtyText && unit) {
    const milli = Math.round(Number(qtyText) * 1000);
    const expected = lineGrossPaise(milli, unit, unit, rate);
    if (expected !== total) flags.push('total_mismatch');
  }
  if (confidence !== null && confidence < 60) flags.push('low_confidence');
  return { id: `ocr-${Date.now()}-${++counter}`, raw: text, name, qtyText, unit, priceUnit: unit, unitPricePaise: rate, lineTotalPaise: total,
    ambiguousAmountPaise: ambiguous, confidence, productId: null, flags: [...new Set(flags)], reviewed: false };
}

export function parseText(text: string, lines?: { text: string; confidence: number | null }[]): DraftItem[] {
  const src = lines && lines.length > 0 ? lines : text.split(/\r?\n/).map((t) => ({ text: t, confidence: null }));
  return src.map((l) => parseLine(l.text, l.confidence)).filter((x): x is DraftItem => x !== null);
}

/** A line is ready for the bill only when the shopkeeper has checked it and it is complete. */
export function isResolved(item: DraftItem): boolean {
  return item.reviewed && item.name.trim().length > 0 && parseQty(item.qtyText).ok && item.unit !== null
    && item.unitPricePaise !== null && item.ambiguousAmountPaise === null
    && unitRatio(item.unit, item.priceUnit ?? item.unit) !== null;
}
