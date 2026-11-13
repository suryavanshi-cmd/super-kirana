// Lets a shopkeeper type "suresh" on an English keyboard and find "सुरेश".
// Both sides are reduced to a rough Latin consonant skeleton; this is only used for search
// and duplicate hints, never to change stored names.

const CONS: Record<string, string> = {
  'क': 'k', 'ख': 'k', 'ग': 'g', 'घ': 'g', 'ङ': 'n', 'च': 'c', 'छ': 'c', 'ज': 'j', 'झ': 'j', 'ञ': 'n',
  'ट': 't', 'ठ': 't', 'ड': 'd', 'ढ': 'd', 'ण': 'n', 'त': 't', 'थ': 't', 'द': 'd', 'ध': 'd', 'न': 'n',
  'प': 'p', 'फ': 'p', 'ब': 'b', 'भ': 'b', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
  'श': 's', 'ष': 's', 'स': 's', 'ह': '', 'क्ष': 'ks', 'ज्ञ': 'dn', 'ऱ': 'r', 'ं': 'n', 'ँ': 'n',
};
const DIGITS = '०१२३४५६७८९';

/** Consonant skeleton of a Devanagari string: सुरेश पाटील → "srs ptl". */
function devanagariSkeleton(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (CONS[ch] !== undefined) out += CONS[ch];
    else if (DIGITS.includes(ch)) out += String(DIGITS.indexOf(ch));
    else if (/\s/.test(ch)) out += ' ';
    else if (/[a-z0-9]/i.test(ch)) out += ch.toLowerCase();
  }
  return out;
}

/** Consonant skeleton of Latin text, with common Indian spelling variants folded. */
function latinSkeleton(s: string): string {
  return s.toLowerCase()
    .replace(/ksh|x/g, 'ks').replace(/ch/g, 'c').replace(/sh/g, 's').replace(/ph|f/g, 'p').replace(/w/g, 'v')
    .replace(/z/g, 'j').replace(/q/g, 'k').replace(/([kgcjtdpb])h/g, '$1').replace(/h/g, '')
    .replace(/[aeiou]/g, '').replace(/([a-z])\1+/g, '$1').replace(/[^a-z0-9 ]/g, '');
}

export function skeleton(s: string): string {
  // An anusvara before p/b/m sounds like m: अंबरी ≈ "ambari".
  const sk = /[ऀ-ॿ]/.test(s) ? devanagariSkeleton(s).replace(/n(?=[pbm])/g, 'm') : latinSkeleton(s);
  return sk.replace(/([a-z])\1+/g, '$1').replace(/\s+/g, ' ').trim();
}

/** True when a Latin query sounds like the start of a word in the (Marathi or English) name. */
export function soundsLike(query: string, name: string): boolean {
  const q = query.trim();
  if (!q || /[ऀ-ॿ]/.test(q)) return false;
  const qs = skeleton(q).replace(/ /g, '');
  if (qs.length < 2) return false;
  const ns = skeleton(name);
  return ns.split(' ').some((_, i, words) => words.slice(i).join('').startsWith(qs));
}

/** Same person written two ways? Used to warn before creating a duplicate customer. */
export function sameName(a: string, b: string): boolean {
  const n = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (n(a) === n(b)) return true;
  const sa = skeleton(a).replace(/ /g, ''), sb = skeleton(b).replace(/ /g, '');
  return sa.length >= 3 && sa === sb;
}
