import type { Unit } from '../money';

/** What any OCR provider must return. Providers only read text; they never decide prices. */
export interface OcrResult { provider: string; text: string; confidence: number | null; lines: { text: string; confidence: number | null }[] }

export interface OcrAdapter {
  id: string;
  /** True when this adapter can run right now (e.g. the cloud key is configured). */
  available(shopId: string): Promise<boolean>;
  recognize(image: Blob, shopId: string, onProgress?: (fraction: number) => void): Promise<OcrResult>;
}

export type Flag = 'price_missing' | 'price_from_catalogue' | 'ambiguous_amount' | 'qty_missing' | 'unit_missing'
  | 'unmatched' | 'low_confidence' | 'total_mismatch';

/** One recognised line. Everything is a draft until the shopkeeper has reviewed it. */
export interface DraftItem {
  id: string;
  raw: string;                       // raw text as read
  name: string;                      // normalised product name (editable)
  qtyText: string;                   // '' when not found
  unit: Unit | null;
  priceUnit: Unit | null;            // the unit the rate is quoted in (e.g. 500 g at a per-kg rate)
  unitPricePaise: number | null;     // never invented: only read, or suggested from the catalogue
  lineTotalPaise: number | null;
  ambiguousAmountPaise: number | null; // a number that may be the rate or the line total
  confidence: number | null;
  productId: string | null;
  flags: Flag[];
  reviewed: boolean;
}
