// OCR providers behind one interface (see docs/OCR.md for how they were chosen).
//   device  — Tesseract (WebAssembly) in the browser. Free, private, works for clear PRINTED
//             Marathi/English. It cannot reliably read handwriting, and the UI says so.
//   cloud   — OCR.space via the `ocr` edge function (Engine 3 reads handwriting). Used whenever the
//             OCR_SPACE_API_KEY secret is set; the device reader is the fallback.
import { supabase, SUPABASE_KEY, SUPABASE_URL } from '../supabase';
import type { OcrAdapter, OcrResult } from './types';

/**
 * Grey-scale + contrast stretch: shop lists are often written in pale pen on lined paper under
 * yellow light. Stretching the 2nd–98th percentile of brightness to full range makes the ink
 * darker and the paper whiter, which helps both OCR engines.
 */
function enhance(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = y; hist[y | 0]++;
  }
  const total = w * h;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const range = Math.max(hi - lo, 1);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

/** Shrinks a camera photo so OCR is fast on a phone and uploads stay small. */
export async function downscale(image: Blob, maxSide = 1800, quality = 0.85): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(image);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    enhance(ctx, canvas.width, canvas.height);
    return await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b ?? image), 'image/jpeg', quality));
  } catch { return image; }
}

export const deviceAdapter: OcrAdapter = {
  id: 'tesseract-device',
  available: async () => typeof WebAssembly !== 'undefined',
  async recognize(image, _shopId, onProgress): Promise<OcrResult> {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(['mar', 'eng'], 1, {
      workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang', gzip: true, workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
    });
    try {
      const { data } = await worker.recognize(await downscale(image), {}, { text: true, blocks: true });
      const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
        .map((l) => ({ text: l.text.trim(), confidence: Math.round(l.confidence) })).filter((l) => l.text);
      return { provider: 'tesseract-device', text: data.text ?? '', confidence: Math.round(data.confidence ?? 0), lines };
    } finally { await worker.terminate(); }
  },
};

async function callCloud(body: Record<string, unknown>): Promise<Response> {
  const { data } = await supabase().auth.getSession();
  return fetch(`${SUPABASE_URL}/functions/v1/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
}

/** JPEG under ~900 KB (OCR.space free plan accepts up to 1 MB). */
async function smallJpeg(image: Blob): Promise<Blob> {
  for (const [side, quality] of [[1800, 0.85], [1500, 0.8], [1200, 0.75], [1000, 0.7]] as const) {
    const b = await downscale(image, side, quality);
    if (b.size <= 900_000) return b;
  }
  return downscale(image, 800, 0.6);
}

export const cloudAdapter: OcrAdapter = {
  id: 'ocr-space',
  async available(shopId) {
    try { return (await callCloud({ shop_id: shopId, probe: true })).ok; } catch { return false; }
  },
  async recognize(image, shopId, onProgress): Promise<OcrResult> {
    onProgress?.(0.2);
    const small = await smallJpeg(image);
    const bytes = new Uint8Array(await small.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    onProgress?.(0.5);
    const res = await callCloud({ shop_id: shopId, image_base64: btoa(bin), mime: small.type || 'image/jpeg' });
    if (!res.ok) throw new Error('OCR_PROVIDER_ERROR');
    const out = (await res.json()) as { text: string; confidence: number | null };
    onProgress?.(1);
    return { provider: 'ocr-space', text: out.text, confidence: out.confidence,
      lines: out.text.split(/\r?\n/).map((t) => t.replace(/\t+/g, ' ').trim()).filter(Boolean).map((t) => ({ text: t, confidence: out.confidence })) };
  },
};

/** OCR.space when it is configured (handles handwriting); the on-device reader if it is not or fails. */
export async function recognizeBest(image: Blob, shopId: string, onProgress?: (f: number) => void): Promise<OcrResult> {
  if (await cloudAdapter.available(shopId)) {
    try { return await cloudAdapter.recognize(image, shopId, onProgress); } catch { /* fall through to the device */ }
  }
  return deviceAdapter.recognize(image, shopId, onProgress);
}
