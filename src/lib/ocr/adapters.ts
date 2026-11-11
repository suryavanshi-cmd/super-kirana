// OCR providers behind one interface (see docs/OCR.md for how they were chosen).
//   device  — Tesseract (WebAssembly) in the browser. Free, private, works for clear PRINTED
//             Marathi/English. It cannot reliably read handwriting, and the UI says so.
//   cloud   — Google Cloud Vision via the ocr-vision edge function. Reads handwriting much better
//             (Devanagari handwriting is "experimental" per Google). Needs an API key; off by default.
import { supabase, SUPABASE_KEY, SUPABASE_URL } from '../supabase';
import type { OcrAdapter, OcrResult } from './types';

/** Shrinks a camera photo so OCR is fast on a phone and uploads stay small. */
export async function downscale(image: Blob, maxSide = 1800): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(image);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b ?? image), 'image/jpeg', 0.85));
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
  return fetch(`${SUPABASE_URL}/functions/v1/ocr-vision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
  });
}

export const cloudAdapter: OcrAdapter = {
  id: 'google-vision',
  async available(shopId) {
    try { return (await callCloud({ shop_id: shopId, probe: true })).ok; } catch { return false; }
  },
  async recognize(image, shopId): Promise<OcrResult> {
    const small = await downscale(image);
    const bytes = new Uint8Array(await small.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = await callCloud({ shop_id: shopId, image_base64: btoa(bin) });
    if (!res.ok) throw new Error('OCR_PROVIDER_ERROR');
    const out = (await res.json()) as { text: string; confidence: number };
    return { provider: 'google-vision', text: out.text, confidence: out.confidence,
      lines: out.text.split(/\r?\n/).filter(Boolean).map((t) => ({ text: t, confidence: out.confidence })) };
  },
};

/** Cloud when it is configured for this shop, otherwise on-device. */
export async function pickAdapter(shopId: string): Promise<OcrAdapter> {
  return (await cloudAdapter.available(shopId)) ? cloudAdapter : deviceAdapter;
}
