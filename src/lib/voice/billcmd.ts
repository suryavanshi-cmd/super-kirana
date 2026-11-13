// Spoken (or typed) changes to the open bill, in Marathi / Hindi / English, e.g.
//   "साखर 52 रुपये करा"            → sugar's rate becomes ₹52
//   "साखर 46 ऐवजी 52"              → same
//   "तूर डाळ 2 किलो"               → quantity 2 kg
//   "शेंगदाणे काढा" / "remove peanuts" → remove the line
//   "पोहे अर्धा किलो जोडा"          → add a line (from the shop's items, at the shop's price)
//   "sugar 52 rupees and toor dal 2 kg" → two changes at once
// It only proposes changes to the bill on this phone; nothing is saved until the bill is confirmed.
import type { Product } from '../api';
import { unitRatio, type Unit } from '../money';
import { findNumbers, nameScore, normalise } from './parse';

export interface CmdLine { id: string; name: string; productId: string | null; unit: Unit; priceUnit: Unit }
export type BillOp =
  | { kind: 'price'; lineId: string; pricePaise: number }
  | { kind: 'qty'; lineId: string; qty: string; unit: Unit }
  | { kind: 'remove'; lineId: string }
  | { kind: 'add'; product: Product | null; name: string; qty: string; unit: Unit; pricePaise: number | null };
export interface CmdResult { ops: BillOp[]; unknown: string[] }

const UNIT_WORDS: [RegExp, Unit][] = [
  [/^(किलो|किलोग्रॅम|केजी|kg|kgs|kilo|kilos|kilogram|किलोला|kilola)$/i, 'kg'],
  [/^(ग्रॅम|ग्राम|gram|grams|gm|gms|g|ग्रॅमला)$/i, 'g'],
  [/^(लिटर|लीटर|litre|liter|litres|liters|ltr|l|लिटरला)$/i, 'litre'],
  [/^(मिली|ml|मिलिलिटर)$/i, 'ml'],
  [/^(पाकीट|पाकिट|पॅकेट|पॅक|पुडा|पुडे|packet|packets|pack|packs|pkt|पाकिटे)$/i, 'packet'],
  [/^(नग|piece|pieces|pc|pcs|नंग|nag|दाणे)$/i, 'piece'],
  [/^(डझन|dozen|darjan|दर्जन)$/i, 'dozen'],
];
const unitOf = (w: string): Unit | null => UNIT_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
const CURRENCY = /^(₹|rs|rs\.|rupees?|rupaye|rupaya|rupay|रुपये|रुपया|रुपए|रुपयांनी|रुपयाला|रु|रू)$/i;
const PRICE_WORD = /^(दर|दराने|भाव|किंमत|किमत|rate|price|bhav|bhaav|kimat|keemat|दाम|daam)$/i;
const PER = /^(प्रति|per|दर|ला)$/i;
const REMOVE = /^(काढा|काढ|काढून|काढून टाका|हटवा|हटाव|हटाओ|रद्द|नको|nako|remove|delete|hatao|hata|nikalo|nikal|cancel|वगळा)$/i;
const ADD = /^(जोडा|जोड|टाका|घाला|add|dalo|daalo|daal|डालो|लिहा|ghala|joda|taka)$/i;
const FILLER = new Set(['करा', 'कर', 'करो', 'करून', 'kar', 'karo', 'kara', 'make', 'set', 'change', 'बदला', 'बदल', 'badla', 'badlo', 'ऐवजी', 'aivaji',
  'instead', 'of', 'to', 'from', 'वरून', 'varun', 'से', 'se', 'की', 'का', 'के', 'चा', 'ची', 'चे', 'चं', 'ला', 'the', 'a', 'is', 'ना', 'आता', 'ata', 'now',
  'नवीन', 'new', 'टाकून', 'नंतर', 'टाक', 'आहे', 'है', 'hai', 'ahe', 'please', 'प्लीज', 'जरा', 'ज़रा', 'zara', 'फक्त', 'only', 'sirf', 'सिर्फ', 'item', 'वस्तू',
  'मध्ये', 'में', 'mein', 'madhe', 'bill', 'बिल', 'बिलात', 'line', 'वर', 'पर', 'par', 'var', 'टाकून', 'द्या', 'दो', 'do', 'dya', 'हो', 'झाला', 'करायचा', 'करायचे']);
const CONJ = /^(आणि|अणि|व|and|aur|और|ani|then|मग|tatha|तथा|plus)$/i;

/** "पाव किलो" → "0.25 किलो", "अर्धा लिटर" → "0.5 लिटर" (only before a unit, so पाव the bread stays). */
function fractions(tokens: string[]): string[] {
  return tokens.map((w, i) => {
    const next = tokens[i + 1] ?? '';
    if (!unitOf(next)) return w;
    if (/^(पाव|paav|pav|quarter)$/i.test(w)) return '0.25';
    if (/^(अर्धा|अर्धी|अर्धे|अर्ध|adha|aadha|ardha|half|आधा|आधी)$/i.test(w)) return '0.5';
    if (/^(पाऊण|paun|pauna|पौन|पौना)$/i.test(w)) return '0.75';
    return w;
  });
}
const strip = (w: string) => w.replace(/(चा|ची|चे|चं|ला|ने|नी|च्या|वर)$/u, '');

function bestLine(heard: string, lines: CmdLine[], products: Product[]): { line: CmdLine; score: number } | null {
  let best: { line: CmdLine; score: number } | null = null;
  for (const l of lines) {
    const p = l.productId ? products.find((x) => x.id === l.productId) : undefined;
    const names = [l.name, p?.name, p?.name_mr, p?.name_en].filter(Boolean) as string[];
    let score = Math.max(...names.map((n) => nameScore(heard, n)));
    if (names.some((n) => n.toLowerCase().includes(heard.toLowerCase()))) score = Math.max(score, 0.95);
    if (!best || score > best.score) best = { line: l, score };
  }
  return best && best.score >= 0.62 ? best : null;
}
function bestProduct(heard: string, products: Product[]): Product | null {
  let best: { p: Product; score: number } | null = null;
  for (const p of products) {
    if (!p.is_active) continue;
    const names = [p.name, p.name_mr, p.name_en].filter(Boolean) as string[];
    let score = Math.max(...names.map((n) => nameScore(heard, n)));
    if (names.some((n) => n.toLowerCase().split(/[\s()]+/).includes(heard.toLowerCase()))) score = Math.max(score, 0.97);
    // Prefer loose / shorter names when equally good ("साखर (सुटे)" over a branded 5 kg pack).
    score -= Math.min(p.name.length, 60) / 2000;
    if (!best || score > best.score) best = { p, score };
  }
  return best && best.score >= 0.72 ? best.p : null;
}

export function parseBillCommand(text: string, lines: CmdLine[], products: Product[]): CmdResult {
  const raw = normalise(text).split(' ').filter(Boolean);
  // Hindi "kar do" / "kar dijiye" ends a command; "do" there is not the number two.
  const tokens = fractions(raw.filter((w, i) => !(/^(do|dijiye|dena|दीजिए|दीजिये)$/i.test(w) && /^(kar|karo|kr|कर|करो)$/i.test(raw[i - 1] ?? ''))));
  // Split into separate commands on commas and "and".
  const segments: string[][] = [[]];
  for (const w of tokens) {
    if (w === ',' || CONJ.test(w)) { if (segments[segments.length - 1].length) segments.push([]); continue; }
    segments[segments.length - 1].push(w);
  }
  const ops: BillOp[] = [];
  const unknown: string[] = [];
  for (const seg of segments.filter((s) => s.length)) {
    const nums = findNumbers(seg);
    const isNum = seg.map(() => false);
    for (const n of nums) for (let k = n.start; k < n.end; k++) isNum[k] = true;
    const remove = seg.some((w) => REMOVE.test(w));
    const add = seg.some((w) => ADD.test(w));
    const hasCurrency = seg.some((w) => CURRENCY.test(w) || PRICE_WORD.test(w));

    // Classify numbers: a number followed by a unit word is a quantity unless the unit is a "per" unit
    // after a price ("52 रुपये किलो", "52 रुपये किलोला"); a number near ₹/rupees/rate is a price.
    let qty: { value: number; unit: Unit } | null = null;
    let price: number | null = null;
    let bare: number | null = null;
    for (const n of nums) {
      const after = seg[n.end] ?? '';
      const after2 = seg[n.end + 1] ?? '';
      const before = seg[n.start - 1] ?? '';
      const u = unitOf(after);
      if (CURRENCY.test(after) || PRICE_WORD.test(before) || CURRENCY.test(before)) { price = n.value; continue; }
      if (u && !(CURRENCY.test(before) || PER.test(before))) {
        qty = { value: n.value, unit: u }; continue;
      }
      if (u === null && unitOf(after2) && CURRENCY.test(after)) { price = n.value; continue; }
      bare = n.value;      // last bare number wins ("46 ऐवजी 52")
    }
    if (price === null && bare !== null && hasCurrency) { price = bare; bare = null; }

    const nameWords = seg.filter((w, k) => !isNum[k] && !unitOf(w) && !CURRENCY.test(w) && !PRICE_WORD.test(w) && !REMOVE.test(w) && !ADD.test(w)
      && !PER.test(w) && !FILLER.has(w.toLowerCase())).map(strip).filter((w) => w.length > 0);
    const heard = nameWords.join(' ').trim();
    if (!heard) { unknown.push(seg.join(' ')); continue; }
    const target = add ? null : bestLine(heard, lines, products);

    if (target) {
      const l = target.line;
      if (remove) { ops.push({ kind: 'remove', lineId: l.id }); continue; }
      let did = false;
      if (price !== null) { ops.push({ kind: 'price', lineId: l.id, pricePaise: Math.round(price * 100) }); did = true; }
      if (qty) {
        const unit = l.productId && !unitRatio(qty.unit, l.priceUnit) ? l.unit : qty.unit;
        ops.push({ kind: 'qty', lineId: l.id, qty: String(qty.value), unit }); did = true;
      }
      if (!did && bare !== null) {
        // "साखर 3" — a small bare number is a quantity, a larger one a rate.
        if (bare < 10 && Number.isInteger(bare * 4)) ops.push({ kind: 'qty', lineId: l.id, qty: String(bare), unit: l.unit });
        else ops.push({ kind: 'price', lineId: l.id, pricePaise: Math.round(bare * 100) });
        did = true;
      }
      if (!did) unknown.push(seg.join(' '));
      continue;
    }
    if (remove) { unknown.push(seg.join(' ')); continue; }
    // Not on the bill yet: add it — from the shop's items when it matches one.
    const p = bestProduct(heard, products);
    const count = qty?.value ?? (bare !== null && bare < 1000 && price !== null ? bare : bare !== null && price === null && bare < 10 ? bare : 1);
    const unit: Unit = qty ? (p && !unitRatio(qty.unit, p.unit) ? p.unit : qty.unit) : p?.unit ?? 'piece';
    if (!p && price === null && !add && !qty) { unknown.push(seg.join(' ')); continue; }
    ops.push({ kind: 'add', product: p, name: p ? p.name : heard.slice(0, 120), qty: String(count), unit,
      pricePaise: price !== null ? Math.round(price * 100) : p ? p.default_price_paise : null });
  }
  return { ops, unknown };
}
