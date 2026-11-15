// Fuzzy customer matching across scripts: Jaro-Winkler on a phonetic key tuned for Indian names.
import { lexicon, lexKey } from './lexicon';
import { jaroWinkler, phoneticKey } from './text';

export interface Customer { id: string; name: string }
export interface IndexedCustomer extends Customer { full: string; first: string; parts: string[] }
export interface Scored { id: string; name: string; score: number }

const stripHonorifics = (words: string[]) => {
  const kept = words.filter((w) => !lexicon.honorifics.has(lexKey(w)));
  return kept.length ? kept : words;
};

/** Pre-computes keys once per shop (cached), so matching a phrase is a cheap loop. */
export function indexCustomers(list: Customer[]): IndexedCustomer[] {
  return list.map((c) => {
    const words = stripHonorifics(c.name.normalize('NFC').toLowerCase().split(/[\s.,-]+/).filter(Boolean));
    const parts = words.map(phoneticKey).filter(Boolean);
    return { id: c.id, name: c.name, full: parts.join(' '), first: parts[0] ?? '', parts };
  });
}

function scoreOne(phrase: string[], full: string, c: IndexedCustomer): number {
  if (!c.full) return 0;
  if (full === c.full) return 1;
  const whole = jaroWinkler(full, c.full);
  const first = phrase.length === 1 ? jaroWinkler(phrase[0], c.first) * 0.96 : 0;
  // every spoken word against its best word in the name (handles "Patil Ramesh", missing surname)
  let sum = 0;
  for (const p of phrase) { let best = 0; for (const q of c.parts) best = Math.max(best, jaroWinkler(p, q)); sum += best; }
  const words = (sum / phrase.length) * (phrase.length < c.parts.length ? 0.96 : 0.98);
  return Math.max(whole, first, words);
}

/** Top-3 candidates for the spoken name, best first. */
export function matchCustomer(spoken: string[], customers: IndexedCustomer[]): Scored[] {
  const phrase = stripHonorifics(spoken).map(phoneticKey).filter(Boolean);
  if (!phrase.length || !customers.length) return [];
  const full = phrase.join(' ');
  const top: Scored[] = [];
  for (const c of customers) {
    const score = scoreOne(phrase, full, c);
    if (score < 0.5) continue;
    if (top.length < 3 || score > top[top.length - 1].score) {
      top.push({ id: c.id, name: c.name, score: Math.round(score * 1000) / 1000 });
      top.sort((a, b) => b.score - a.score);
      if (top.length > 3) top.pop();
    }
  }
  return top;
}
