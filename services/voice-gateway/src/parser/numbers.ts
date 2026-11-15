// Amounts from digits or spoken number words (Marathi, Hindi, English), e.g.
//   "250", "२५०", "दोनशे पन्नास", "don she pannas", "dide-she" (150), "अडीच हजार" (2500),
//   "sava don hajar" (2250), "saade teen she" (350), "paune paach she" (475), "two hundred fifty".
import { looseLatin } from './text';

// Marathi 1–99 in Devanagari (index = value).
const MR_DEV = ['', 'एक', 'दोन', 'तीन', 'चार', 'पाच', 'सहा', 'सात', 'आठ', 'नऊ', 'दहा',
  'अकरा', 'बारा', 'तेरा', 'चौदा', 'पंधरा', 'सोळा', 'सतरा', 'अठरा', 'एकोणीस', 'वीस',
  'एकवीस', 'बावीस', 'तेवीस', 'चोवीस', 'पंचवीस', 'सव्वीस', 'सत्तावीस', 'अठ्ठावीस', 'एकोणतीस', 'तीस',
  'एकतीस', 'बत्तीस', 'तेहेतीस', 'चौतीस', 'पस्तीस', 'छत्तीस', 'सदतीस', 'अडतीस', 'एकोणचाळीस', 'चाळीस',
  'एक्केचाळीस', 'बेचाळीस', 'त्रेचाळीस', 'चव्वेचाळीस', 'पंचेचाळीस', 'सेहेचाळीस', 'सत्तेचाळीस', 'अठ्ठेचाळीस', 'एकोणपन्नास', 'पन्नास',
  'एक्कावन्न', 'बावन्न', 'त्रेपन्न', 'चोपन्न', 'पंचावन्न', 'छप्पन्न', 'सत्तावन्न', 'अठ्ठावन्न', 'एकोणसाठ', 'साठ',
  'एकसष्ठ', 'बासष्ठ', 'त्रेसष्ठ', 'चौसष्ठ', 'पासष्ठ', 'सहासष्ठ', 'सदुसष्ठ', 'अडुसष्ठ', 'एकोणसत्तर', 'सत्तर',
  'एक्काहत्तर', 'बाहत्तर', 'त्र्याहत्तर', 'चौऱ्याहत्तर', 'पंच्याहत्तर', 'शहात्तर', 'सत्त्याहत्तर', 'अठ्ठ्याहत्तर', 'एकोणऐंशी', 'ऐंशी',
  'एक्क्याऐंशी', 'ब्याऐंशी', 'त्र्याऐंशी', 'चौऱ्याऐंशी', 'पंच्याऐंशी', 'शहाऐंशी', 'सत्त्याऐंशी', 'अठ्ठ्याऐंशी', 'एकोणनव्वद', 'नव्वद',
  'एक्क्याण्णव', 'ब्याण्णव', 'त्र्याण्णव', 'चौऱ्याण्णव', 'पंच्याण्णव', 'शहाण्णव', 'सत्त्याण्णव', 'अठ्ठ्याण्णव', 'नव्व्याण्णव'];

// Marathi 1–99 as people type / romanise them.
const MR_LAT = ['', 'ek', 'don', 'teen', 'char', 'pach', 'saha', 'saat', 'aath', 'nau', 'daha',
  'akra', 'bara', 'tera', 'chauda', 'pandhra', 'sola', 'satra', 'athra', 'ekonis', 'vees',
  'ekvis', 'bavis', 'tevis', 'chovis', 'panchvis', 'savvis', 'sattavis', 'atthavis', 'ekonatis', 'tees',
  'ektis', 'battis', 'tehetis', 'chautis', 'pastis', 'chhattis', 'sadtis', 'adtis', 'ekonchalis', 'chalis',
  'ekkechalis', 'bechalis', 'trechalis', 'chavvechalis', 'panchechalis', 'sehechalis', 'sattechalis', 'atthechalis', 'ekonpannas', 'pannas',
  'ekkavanna', 'bavanna', 'trepanna', 'chopanna', 'panchavanna', 'chhappanna', 'sattavanna', 'atthavanna', 'ekonsath', 'saath',
  'eksashta', 'basashta', 'tresashta', 'chausashta', 'pasashta', 'sahasashta', 'sadusashta', 'adusashta', 'ekonsattar', 'sattar',
  'ekkahattar', 'bahattar', 'tryahattar', 'chauryahattar', 'panchyahattar', 'shahattar', 'sattyahattar', 'atthyahattar', 'ekonainshi', 'ainshi',
  'ekkyaainshi', 'byaainshi', 'tryaainshi', 'chauryaainshi', 'panchyaainshi', 'shahaainshi', 'sattyaainshi', 'atthyaainshi', 'ekonnavvad', 'navvad',
  'ekkyannav', 'byannav', 'tryannav', 'chauryannav', 'panchyannav', 'shahannav', 'sattyannav', 'atthyannav', 'navvyannav'];

// Hindi 1–99 (Latin; Devanagari Hindi forms below for the common ones).
const HI_LAT = ['', 'ek', 'do', 'teen', 'char', 'paanch', 'chhah', 'saat', 'aath', 'nau', 'das',
  'gyarah', 'barah', 'terah', 'chaudah', 'pandrah', 'solah', 'satrah', 'atharah', 'unnis', 'bees',
  'ikkis', 'baais', 'teis', 'chaubis', 'pachchis', 'chhabbis', 'sattais', 'athais', 'untis', 'tees',
  'iktis', 'battis', 'taintis', 'chautis', 'paintis', 'chhattis', 'saintis', 'adtis', 'untalis', 'chalis',
  'iktalis', 'bayalis', 'taintalis', 'chavalis', 'paintalis', 'chhiyalis', 'saintalis', 'adtalis', 'unchas', 'pachas',
  'ikyavan', 'bavan', 'tirpan', 'chauvan', 'pachpan', 'chhappan', 'sattavan', 'athavan', 'unsath', 'saath',
  'iksath', 'basath', 'tirsath', 'chausath', 'painsath', 'chhiyasath', 'sadsath', 'adsath', 'unhattar', 'sattar',
  'ikhattar', 'bahattar', 'tihattar', 'chauhattar', 'pachhattar', 'chhihattar', 'satattar', 'athhattar', 'unasi', 'assi',
  'ikyasi', 'bayasi', 'tirasi', 'chaurasi', 'pachasi', 'chhiyasi', 'sattasi', 'athasi', 'navasi', 'nabbe',
  'ikyanve', 'banve', 'tiranve', 'chauranve', 'pachanve', 'chhiyanve', 'sattanve', 'athanve', 'ninyanve'];
const HI_DEV: Record<string, number> = { 'दो': 2, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'दस': 10, 'बीस': 20, 'पचास': 50, 'पच्चीस': 25, 'सौ': 100, 'हज़ार': 1000, 'हजार': 1000 };

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export type Mult = 100 | 1000 | 100000;
const MULT_DEV: Record<string, Mult> = { 'शे': 100, 'शंभर': 100, 'सौ': 100, 'हजार': 1000, 'हज़ार': 1000, 'लाख': 100000 };
const MULT_LAT: Record<string, Mult> = { she: 100, shambhar: 100, shembhar: 100, sau: 100, hundred: 100, hajar: 1000, hazar: 1000, hazaar: 1000, hajaar: 1000, thousand: 1000, lakh: 100000, lac: 100000, lakhs: 100000 };

/** sava +¼ (सव्वा दोन = 2.25; alone = 1.25) · saade +½ · paune −¼ — applied to the number that follows. */
export type Frac = 'sava' | 'saade' | 'paune';
const FRAC_DEV: Record<string, Frac> = { 'सव्वा': 'sava', 'सवा': 'sava', 'साडे': 'saade', 'साडेतीन': 'saade', 'पावणे': 'paune', 'पौने': 'paune' };
const FRAC_LAT: Record<string, Frac> = { sava: 'sava', savva: 'sava', sawa: 'sava', saade: 'saade', sade: 'saade', saadhe: 'saade', sadhe: 'saade', paune: 'paune', pavne: 'paune', pavane: 'paune', pone: 'paune' };
// Stand-alone fractional numbers.
const HALF_DEV: Record<string, number> = { 'दीड': 1.5, 'दिड': 1.5, 'डेढ़': 1.5, 'अडीच': 2.5, 'अढाई': 2.5, 'ढाई': 2.5, 'अर्धा': 0.5, 'पाव': 0.25 };
const HALF_LAT: Record<string, number> = { did: 1.5, dide: 1.5, deed: 1.5, deedh: 1.5, dedh: 1.5, adich: 2.5, adhich: 2.5, adeech: 2.5, dhai: 2.5, adhai: 2.5 };

const DEV_WORD = new Map<string, number>();
MR_DEV.forEach((w, n) => { if (w) DEV_WORD.set(w, n); });
Object.entries(HI_DEV).forEach(([w, n]) => { if (n < 100) DEV_WORD.set(w, n); });
const LAT_WORD = new Map<string, number>();
const addLat = (w: string, n: number) => { const k = looseLatin(w); if (!LAT_WORD.has(k)) LAT_WORD.set(k, n); };
MR_LAT.forEach((w, n) => { if (w) addLat(w, n); });
HI_LAT.forEach((w, n) => { if (w) addLat(w, n); });
EN_ONES.forEach((w, n) => { if (n) addLat(w, n); });
EN_TENS.forEach((w, i) => { if (w) addLat(w, i * 10); });
// Extra spellings people and ASR produce.
([['tin', 3], ['paach', 5], ['panch', 5], ['saha', 6], ['sat', 7], ['ath', 8], ['nav', 9], ['dahaa', 10], ['vis', 20], ['tis', 30], ['pannaas', 50], ['panas', 50], ['sath', 60], ['ainshi', 80], ['aenshi', 80], ['navad', 90], ['pachis', 25], ['pachhis', 25]] as const)
  .forEach(([w, n]) => addLat(w, n));

export type NumTok = { kind: 'num'; value: number } | { kind: 'mult'; value: Mult } | { kind: 'frac'; value: Frac };

/** Classifies ONE token (already normalised). "दोनशे" / "donshe" / "250" are handled too. */
export function numberToken(tok: string): NumTok[] | null {
  if (/^\d+(\.\d+)?$/.test(tok)) return [{ kind: 'num', value: Number(tok) }];
  const dev = /[ऀ-ॿ]/.test(tok);
  if (dev) {
    if (DEV_WORD.has(tok)) return [{ kind: 'num', value: DEV_WORD.get(tok)! }];
    if (HALF_DEV[tok] !== undefined) return [{ kind: 'num', value: HALF_DEV[tok] }];
    if (MULT_DEV[tok]) return [{ kind: 'mult', value: MULT_DEV[tok] }];
    if (FRAC_DEV[tok]) return [{ kind: 'frac', value: FRAC_DEV[tok] }];
    // "दोनशे", "अडीचशे", "पाचशेचे" (a few endings), "दीडहजार"
    const m = tok.replace(/(चे|चा|ची|ला|ना)$/, '').match(/^(.+?)(शे|हजार|लाख)$/);
    if (m) {
      const head = numberToken(m[1]);   // "दोनशे", and with a fraction word: "सव्वाशे" = 125
      if (head && head.length === 1 && (head[0].kind === 'num' || head[0].kind === 'frac')) return [head[0], { kind: 'mult', value: MULT_DEV[m[2]] }];
    }
    return null;
  }
  const k = looseLatin(tok);
  if (LAT_WORD.has(k)) return [{ kind: 'num', value: LAT_WORD.get(k)! }];
  if (HALF_LAT[k] !== undefined) return [{ kind: 'num', value: HALF_LAT[k] }];
  if (MULT_LAT[tok] || MULT_LAT[k]) return [{ kind: 'mult', value: (MULT_LAT[tok] ?? MULT_LAT[k])! }];
  if (FRAC_LAT[tok] || FRAC_LAT[k]) return [{ kind: 'frac', value: (FRAC_LAT[tok] ?? FRAC_LAT[k])! }];
  const m = k.match(/^(.+?)(she|se|sau|hajar|hazar|lakh)$/);
  if (m && m[1].length >= 2) {
    const head = numberToken(m[1]);
    const mult = numberToken(m[2] === 'se' ? 'she' : m[2]);
    if (head && head.length === 1 && head[0].kind === 'num' && mult) return [head[0], ...mult];
  }
  return null;
}

const applyFrac = (f: Frac | null, n: number) => (f === 'sava' ? n + 0.25 : f === 'saade' ? n + 0.5 : f === 'paune' ? n - 0.25 : n);

/**
 * Value of a run of number tokens: "don she pannas" → 250, "adich hajar" → 2500,
 * "sava don hajar" → 2250, "2 hajar 500" → 2500. Returns null when nothing numeric.
 */
export function evaluate(run: NumTok[]): number | null {
  let total = 0, current = 0, frac: Frac | null = null, seen = false;
  for (const t of run) {
    if (t.kind === 'frac') { frac = t.value; continue; }
    if (t.kind === 'num') {
      seen = true;
      current += applyFrac(frac, t.value);
      frac = null;
      continue;
    }
    seen = true;
    if (frac) { current += applyFrac(frac, 1); frac = null; }        // "sava she" = 125
    const base = current || 1;
    if (t.value === 100) current = base * 100;
    else { total += base * t.value; current = 0; }
  }
  if (frac) { current += applyFrac(frac, 1); seen = true; }
  if (!seen) return null;
  return Math.round((total + current) * 100) / 100;
}
