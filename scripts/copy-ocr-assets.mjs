// Copies the on-device OCR engine and the Marathi + English language data into /public/ocr so the
// app serves them itself (no third-party CDN, works with the Content-Security-Policy).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const nm = (p) => path.join(root, 'node_modules', p);
const out = path.join(root, 'public', 'ocr');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'core'), { recursive: true });
mkdirSync(path.join(out, 'lang'), { recursive: true });

cpSync(nm('tesseract.js/dist/worker.min.js'), path.join(out, 'worker.min.js'));
// tesseract.js picks one of these by CPU feature detection; each embeds its own WebAssembly.
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  cpSync(nm(`tesseract.js-core/${f}`), path.join(out, 'core', f));
}
for (const lang of ['eng', 'mar']) {
  cpSync(nm(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), path.join(out, 'lang', `${lang}.traineddata.gz`));
}
console.log('OCR assets copied to public/ocr');
