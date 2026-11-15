// Text helpers shared by the parser: normalisation, Devanagari → Latin, loose keys for matching.

const DEV_DIGITS = /[०-९]/g;
const DEVANAGARI = /[ऀ-ॿ]/;

export const isDevanagari = (s: string) => DEVANAGARI.test(s);

/** NFC, Devanagari digits → 0-9, lower-case Latin, punctuation → space, hyphens split ("don-she"). */
export function normalise(input: string): string {
  return input
    .normalize('NFC')
    .replace(DEV_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[‌‍]/g, '')                       // zero-width joiners
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, '$1')                         // 2,500 → 2500
    .replace(/₹\s*/g, ' ₹ ')
    .replace(/(\d)(rs|rupaye|rupees|रु|रुपये)\b/g, '$1 $2')
    .replace(/[|।॥.,!?;:"'“”‘’()[\]{}<>/\\_*#@&+=~`^-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Devanagari → Latin (simple, for matching only) ----------------------------------------
const V: Record<string, string> = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ru', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ॲ': 'a', 'ऍ': 'e' };
const M: Record<string, string> = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ru', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e', 'ॆ': 'e', 'ॊ': 'o' };
const C: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ऱ': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f', 'य़': 'y',
};
const VIRAMA = '्', ANUSVARA = 'ं', CHANDRA = 'ँ', VISARGA = 'ः', NUKTA = '़';

/** रमेश पाटील → "ramesh patil". Inherent "a" is kept between consonants and dropped at word end. */
export function romanise(word: string): string {
  if (!isDevanagari(word)) return word;
  const chars = [...word.normalize('NFC').replace(new RegExp(NUKTA, 'g'), '')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (C[ch] !== undefined) {
      out += C[ch];
      const next = chars[i + 1];
      if (next === VIRAMA) { i++; continue; }
      if (next !== undefined && M[next] !== undefined) continue;          // the matra supplies the vowel
      const atEnd = next === undefined || next === ' ';
      if (!atEnd) out += 'a';                                              // inherent vowel (dropped at word end)
    } else if (M[ch] !== undefined) out += M[ch];
    else if (V[ch] !== undefined) out += V[ch];
    else if (ch === ANUSVARA || ch === CHANDRA) {
      const n = chars[i + 1];
      out += n && /[पफबभम]/.test(n) ? 'm' : 'n';
    } else if (ch === VISARGA) out += 'h';
    else if (ch === VIRAMA) continue;
    else out += ch;
  }
  return out;
}

/**
 * Loose phonetic key for Indian names and words, in Latin script:
 * aa→a, ee/ii→i, oo/uu→u, w→v, z→j, ph→f, sh/s→s, ksh→x, doubled letters once, "h" after a
 * consonant dropped (bh→b, dh→d, th→t, chh/ch→c), final "a" dropped (ramesha → ramesh).
 */
export function phoneticKey(input: string): string {
  let s = romanise(input).toLowerCase().replace(/[^a-z ]/g, '');
  s = s.replace(/ksh/g, 'x').replace(/chh/g, 'c').replace(/ch/g, 'c').replace(/sh/g, 's').replace(/ph/g, 'f')
    .replace(/([bcdgjkpt])h/g, '$1').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k')
    .replace(/ee|ii|ie/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a').replace(/ai/g, 'e').replace(/au|ou/g, 'o')
    .replace(/(.)\1+/g, '$1')
    .replace(/a\b/g, '')            // final schwa
    .replace(/\s+/g, ' ').trim();
  return s;
}

/** Loose Latin form used for dictionary lookups (keeps vowels, unlike phoneticKey's schwa drop). */
export function looseLatin(word: string): string {
  return word.toLowerCase()
    .replace(/ee|ii/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a').replace(/w/g, 'v').replace(/z/g, 'j')
    .replace(/(.)\1+/g, '$1');
}

/** Jaro-Winkler similarity, 0..1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false), bm = new Array<boolean>(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}
