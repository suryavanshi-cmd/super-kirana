// Loads config/lexicon.json once at start-up into fast lookup tables.
import raw from '../../config/lexicon.json' with { type: 'json' };
import { isDevanagari, looseLatin } from './text';

export type EntryType = 'credit' | 'payment';
interface LexiconFile {
  actions: Record<EntryType, string[]>;
  fillers: string[];
  amount_markers: string[];
  honorifics: string[];
  items: Record<string, string[]>;
}

const key = (w: string) => (isDevanagari(w) ? w.normalize('NFC') : looseLatin(w));

export class Lexicon {
  readonly actions = new Map<string, EntryType>();      // single words
  readonly actionPairs = new Map<string, EntryType>();  // "le gaye", "de gaye"
  readonly fillers = new Set<string>();
  readonly markers = new Set<string>();
  readonly honorifics = new Set<string>();
  readonly items = new Map<string, string>();           // synonym key → canonical item
  readonly itemPairs = new Map<string, string>();       // two-word synonyms ("toor dal", "cold drink")
  readonly itemStems: { stem: string; item: string; dev: boolean }[] = [];

  constructor(file: LexiconFile) {
    for (const type of ['credit', 'payment'] as const) for (const w of file.actions[type]) {
      const parts = w.trim().split(/\s+/);
      if (parts.length === 2) this.actionPairs.set(parts.map(key).join(' '), type); else this.actions.set(key(w), type);
    }
    for (const w of file.fillers) this.fillers.add(key(w));
    for (const w of file.amount_markers) this.markers.add(key(w));
    for (const w of file.honorifics) this.honorifics.add(key(w));
    for (const [item, syns] of Object.entries(file.items)) for (const s of [item, ...syns]) {
      const parts = s.trim().split(/\s+/);
      if (parts.length === 2) this.itemPairs.set(parts.map(key).join(' '), item);
      else {
        this.items.set(key(s), item);
        if (s.length >= 3) this.itemStems.push({ stem: key(s), item, dev: isDevanagari(s) });
      }
    }
    this.itemStems.sort((a, b) => b.stem.length - a.stem.length);   // longest stem wins
  }

  isMarker(tok: string): boolean {
    const k = key(tok);
    return this.markers.has(k) || /^(रुप|रूप|rupay|rupai|rupee|rupya)/.test(tok);
  }
  action(tok: string): EntryType | null {
    const k = key(tok);
    const hit = this.actions.get(k);
    if (hit) return hit;
    if (/^(घेतल|नेल|उधार)/.test(tok) || /^(ghetl|udhar)/.test(k)) return 'credit';
    if (/^(भरल|जमा)/.test(tok) || /^(bharl)/.test(k)) return 'payment';
    return null;
  }
  item(tok: string): string | null {
    const k = key(tok);
    const hit = this.items.get(k);
    if (hit) return hit;
    // inflected forms: साखरेचे, sakharche, telacha
    for (const s of this.itemStems) if (s.stem.length >= (s.dev ? 3 : 4) && k.startsWith(s.stem)) return s.item;
    return null;
  }
}

export const lexicon = new Lexicon(raw as unknown as LexiconFile);
export { key as lexKey };
