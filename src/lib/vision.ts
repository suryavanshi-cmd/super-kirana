'use client';
// Photo → bill lines through the `bill-vision` edge function (Gemini). Fast path for the scan screen.
import type { Line } from './draft';
import { lineId } from './draft';
import { paiseToInputText, type Unit } from './money';
import { downscale } from './ocr/adapters';
import { callFunction } from './api';
import { supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase';

export interface VisionLine { product_id: string | null; name: string; heard: string; qty: string; unit: Unit; price_unit: Unit; price_paise: number | null; paper_price_paise: number | null; flags: string[] }
export interface VisionResult { lines: VisionLine[]; total_paise: number | null; model: string; ms: number }

async function call(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  const { data } = await supabase().auth.getSession();
  return fetch(`${SUPABASE_URL}/functions/v1/bill-vision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
}

let probed: { shop: string; ok: boolean } | null = null;
export async function visionAvailable(shopId: string): Promise<boolean> {
  if (probed?.shop === shopId) return probed.ok;
  try { const ok = (await call({ shop_id: shopId, probe: true }, 8000)).ok; probed = { shop: shopId, ok }; return ok; } catch { return false; }
}

/** Small colour JPEG: enough detail for handwriting, fast to upload on 4G (~150–300 KB). */
export async function prepare(image: Blob): Promise<{ base64: string; mime: string }> {
  let small = await downscale(image, 1600, 0.72, false);
  if (small.size > 600_000) small = await downscale(image, 1280, 0.65, false);
  const bytes = new Uint8Array(await small.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), mime: small.type || 'image/jpeg' };
}

export async function readBillPhoto(prepared: { base64: string; mime: string }, shopId: string): Promise<VisionResult> {
  // Throws an AppError carrying the real reason (e.g. "bill-vision · HTTP 429 · gemini-2.5-flash: quota exceeded").
  return callFunction<VisionResult>('bill-vision', { shop_id: shopId, image_base64: prepared.base64, mime: prepared.mime }, 40_000);
}

export function toDraftLines(r: VisionResult): Line[] {
  return r.lines.map((v) => ({
    id: lineId(), productId: v.product_id, name: v.name, qty: v.qty, unit: v.unit, priceUnit: v.price_unit,
    price: v.price_paise === null ? '' : paiseToInputText(v.price_paise), discount: '', fromOcr: true,
    flags: v.flags, heard: v.heard, paperPrice: v.paper_price_paise ?? undefined,
  }));
}
