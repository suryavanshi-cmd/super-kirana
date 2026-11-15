// Transcript → khata draft. Deterministic, no AI. Expected order (but tolerant of others):
//   <customer name> <amount> [rupaye] [item(s)] <action>
//   "रमेश पाटील 250 रुपये साखर घेतले", "Sunita tai don-she pannas dile"
import { lexicon, type EntryType } from './lexicon';
import { matchCustomer, type IndexedCustomer, type Scored } from './match';
import { evaluate, numberToken, type NumTok } from './numbers';
import { normalise, phoneticKey, romanise, jaroWinkler } from './text';

export interface ShopItem { name: string; key: string; words: string[] }
export interface Draft {
  transcript: string;
  customer: { id: string | null; name: string; confidence: number; needs_choice: boolean; alternatives: Scored[] };
  amount: number | null;
  items: string[];
  type: EntryType | null;
  overall_confidence: number;
  needs_confirmation: true;
  missing: ('customer' | 'amount' | 'type')[];
}

type Tok =
  | { t: 'word'; text: string }
  | { t: 'num'; parts: NumTok[]; digits: boolean }
  | { t: 'marker' }
  | { t: 'action'; type: EntryType }
  | { t: 'item'; item: string };

const MIN_CONFIDENT = 0.8, MIN_GAP = 0.08;

export function indexItems(names: string[]): ShopItem[] {
  return names.map((name) => {
    const key = phoneticKey(name);
    return { name, key, words: key.split(' ').filter((w) => w.length >= 4 && !/\d/.test(w)) };
  }).filter((i) => i.key.length >= 3);
}

function tokenize(text: string): Tok[] {
  const words = text.split(' ').filter(Boolean);
  const out: Tok[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const pair = i + 1 < words.length ? `${w} ${words[i + 1]}` : '';
    if (pair) {
      const loose = pair.split(' ').map((x) => (/[ऀ-ॿ]/.test(x) ? x : x.replace(/(.)\1+/g, '$1'))).join(' ');
      const act = lexicon.actionPairs.get(loose);
      if (act) { out.push({ t: 'action', type: act }); i++; continue; }
      const item = lexicon.itemPairs.get(loose);
      if (item) { out.push({ t: 'item', item }); i++; continue; }
    }
    if (w === '₹' || lexicon.isMarker(w)) { out.push({ t: 'marker' }); continue; }
    const num = numberToken(w);
    if (num) { out.push({ t: 'num', parts: num, digits: /\d/.test(w) }); continue; }
    const act = lexicon.action(w);
    if (act) { out.push({ t: 'action', type: act }); continue; }
    const item = lexicon.item(w);
    if (item) { out.push({ t: 'item', item }); continue; }
    if (lexicon.fillers.has(/[ऀ-ॿ]/.test(w) ? w : w.replace(/(.)\1+/g, '$1')) || lexicon.fillers.has(w)) continue;
    out.push({ t: 'word', text: w });
  }
  return out;
}

/** Picks the amount run: the one followed by "rupaye", else the first one after the name, else the first. */
function findAmount(toks: Tok[]): { start: number; end: number; value: number; digits: boolean } | null {
  const runs: { start: number; end: number; marked: boolean; afterWord: boolean }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t !== 'num' && !(toks[i].t === 'marker' && toks[i + 1]?.t === 'num')) continue;
    let j = i;
    while (j < toks.length && (toks[j].t === 'num' || (toks[j].t === 'marker' && j === i))) j++;
    const marked = toks[j]?.t === 'marker' || toks[i].t === 'marker';
    runs.push({ start: i, end: j, marked, afterWord: toks.slice(0, i).some((x) => x.t === 'word') });
    i = j;
  }
  const pick = runs.find((r) => r.marked) ?? runs.find((r) => r.afterWord) ?? runs[0];
  if (!pick) return null;
  const parts: NumTok[] = [];
  let digits = false;
  for (let k = pick.start; k < pick.end; k++) { const x = toks[k]; if (x.t === 'num') { parts.push(...x.parts); digits ||= x.digits; } }
  const value = evaluate(parts);
  if (value === null || value <= 0 || value > 10_000_000) return null;
  let end = pick.end;
  if (toks[end]?.t === 'marker') end++;
  return { start: pick.start, end, value, digits };
}

export function parse(transcript: string, customers: IndexedCustomer[], shopItems: ShopItem[] = []): Draft {
  const toks = tokenize(normalise(transcript));
  const amount = findAmount(toks);

  // Customer = words before the amount (or before the first item/action when there is no amount).
  const stop = amount ? amount.start : toks.findIndex((x) => x.t === 'item' || x.t === 'action');
  const before = toks.slice(0, stop < 0 ? toks.length : stop);
  let nameWords = before.flatMap((x) => (x.t === 'word' ? [x.text] : []));
  const after = amount ? toks.slice(amount.end) : toks.slice(stop < 0 ? toks.length : stop);
  if (!nameWords.length && amount) nameWords = after.flatMap((x) => (x.t === 'word' ? [x.text] : [])).slice(0, 3);   // "250 रुपये रमेश ..."

  const type = (toks.find((x) => x.t === 'action') as { type: EntryType } | undefined)?.type ?? null;

  // Items: dictionary hits anywhere after the name, then leftover words after the amount (shop items first).
  const items: string[] = [];
  const push = (s: string) => { if (s && !items.includes(s)) items.push(s); };
  for (const x of toks) if (x.t === 'item') push(x.item);
  if (amount) {
    const leftover = after.flatMap((x) => (x.t === 'word' && !nameWords.includes(x.text) ? [x.text] : []));
    for (const w of leftover) {
      const k = phoneticKey(w);
      let best: ShopItem | null = null, bestScore = 0;
      for (const it of shopItems) {
        let s = jaroWinkler(k, it.key);
        if (k.length >= 4) for (const w of it.words) s = Math.max(s, jaroWinkler(k, w) - 0.02);   // "fortune" → "Fortune Sunflower Oil 1 L"
        if (s > bestScore) { bestScore = s; best = it; }
      }
      if (matchCustomer([w], customers)[0]?.score >= 0.92) continue;   // a second customer's name, not an item
      if (best && bestScore >= 0.9) push(best.name);
      else if (w.length >= 3 && !/^(la|ला|na|ना|che|cha|chi|चे|चा|ची|kade|कडे|madhe|मध्ये|sathi|साठी)$/.test(w)) push(w);
    }
  }

  // Customer match.
  const alternatives = matchCustomer(nameWords, customers);
  const top = alternatives[0];
  const gap = top ? top.score - (alternatives[1]?.score ?? 0) : 0;
  const sure = !!top && top.score >= MIN_CONFIDENT && gap >= MIN_GAP;
  const heard = nameWords.join(' ');
  const customer = {
    id: sure ? top.id : null,
    name: sure ? top.name : heard || (top?.name ?? ''),
    confidence: top ? top.score : 0,
    needs_choice: !sure && alternatives.length > 0,
    alternatives,
  };

  const missing: Draft['missing'] = [];
  if (!heard && !top) missing.push('customer');
  if (!amount) missing.push('amount');
  if (!type) missing.push('type');
  const custConf = sure ? top.score : top ? top.score * 0.6 : 0;
  const amtConf = amount ? (amount.digits ? 0.98 : 0.9) : 0;
  const overall = Math.round((0.5 * custConf + 0.35 * amtConf + 0.15 * (type ? 1 : 0)) * 1000) / 1000;

  return { transcript, customer, amount: amount?.value ?? null, items, type, overall_confidence: overall, needs_confirmation: true, missing };
}

export { romanise };
