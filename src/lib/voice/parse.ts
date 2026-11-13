// Understands one spoken (or typed) sentence about a customer's account, in Marathi, English,
// Hindi or a mix, e.g.
//   "सुरेश भट यांनी 2,000 रुपयाचा किराणा घेतला, नो पेमेंट"
//   "kab se hotel Ambari 250 rupees pending"
//   "Meena ne 500 jama kele"
// It only proposes a draft (who, credit or payment, amounts). Nothing is saved from here: the
// shopkeeper confirms on the normal उधारी / पैसे जमा screens.
import type { CustomerRow } from '../api';
import { sameName, skeleton } from '../translit';
import { MR_0_99 } from '../words';

export type Intent = 'credit' | 'payment';
export interface VoiceDraft {
  text: string;
  intent: Intent;
  amountPaise: number | null;      // bill amount (credit) or amount received (payment)
  paidPaise: number | null;        // credit only: money paid now (0 when "no payment")
  what: string | null;             // credit only: what was bought, if said
  name: string;                    // spoken name, as heard
  matches: { customer: CustomerRow; score: number }[];
  problems: ('no_amount' | 'no_name')[];
}

// ------------------------------------------------------------------ numbers
const WORD_NUM = new Map<string, number>();
MR_0_99.forEach((w, i) => WORD_NUM.set(w, i));
const EXTRA: Record<string, number> = {
  // English
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // Hindi (Devanagari and Latin)
  'दो': 2, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छे': 6, 'नौ': 9, 'दस': 10, 'बीस': 20, 'तीस': 30, 'चालीस': 40, 'पचास': 50, 'साठ': 60,
  'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90, 'पच्चीस': 25,
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhe: 6, che: 6, saat: 7, sat: 7, aath: 8, nau: 9, das: 10,
  bees: 20, bis: 20, pachis: 25, pachchis: 25, tees: 30, chalis: 40, pachas: 50, pachaas: 50, sath: 60, saath: 60, sattar: 70, assi: 80, nabbe: 90,
  // Marathi in Latin letters
  don: 2, pach: 5, saha: 6, daha: 10, pannas: 50, vees: 20, vis: 20, pachvis: 25,
};
for (const [k, v] of Object.entries(EXTRA)) WORD_NUM.set(k, v);
const HUNDRED = /^(शंभर|शे|सौ|hundred|sau|shambhar|she)$/i;
const THOUSAND = /^(हजार|हज़ार|thousand|hazar|hajar|hazaar)$/i;
const LAKH = /^(लाख|lakh|lac|lakhs)$/i;
const FRACTION: Record<string, number> = { 'दीड': 1.5, 'डेढ़': 1.5, 'डेढ': 1.5, 'अडीच': 2.5, 'ढाई': 2.5, 'सव्वा': 1.25, 'पावणे': -0.25, dedh: 1.5, dhai: 2.5, adich: 2.5, sava: 1.25 };
const SADE = /^(साडे|साढ़े|साढे|sade|sadhe)$/i;

export function normalise(text: string): string {
  let s = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    s += cp >= 0x0966 && cp <= 0x096f ? String(cp - 0x0966) : ch;    // Devanagari digits → ASCII
  }
  return s
    .replace(/(\d),(?=\d{2,3}\b)/g, '$1')                              // 2,000 / 1,25,000
    .replace(/₹\s*/g, ' ₹ ')
    .replace(/(\d)([^\d\s.,])/g, '$1 $2').replace(/([^\d\s.₹])(\d)/g, '$1 $2')
    .replace(/(\S+?)शे(?=\s|$)/g, (m, w: string) => (WORD_NUM.has(w) || FRACTION[w] !== undefined ? `${w} शे` : m))   // पाचशे → पाच शे, अडीचशे
    .replace(/[,.!?।]+(\s|$)/g, ' , ')
    .replace(/\s+/g, ' ').trim();
}

export interface NumTok { start: number; end: number; value: number }

/** Finds every amount in the tokens: "2000", "दोन हजार", "अडीचशे", "two thousand five hundred", "साडे तीन हजार". */
export function findNumbers(tokens: string[]): NumTok[] {
  const out: NumTok[] = [];
  let i = 0;
  while (i < tokens.length) {
    const start = i;
    let total = 0, current = 0, any = false, pendingFraction = 0, sade = false;
    while (i < tokens.length) {
      const w = tokens[i].toLowerCase();
      if (/^\d+(\.\d+)?$/.test(w)) { current += Number(w); any = true; i++; continue; }
      if (WORD_NUM.has(w)) { current += WORD_NUM.get(w)!; any = true; i++; continue; }
      if (FRACTION[w] !== undefined) { pendingFraction = FRACTION[w]; any = true; i++; continue; }
      if (SADE.test(w)) { sade = true; any = true; i++; continue; }
      const mult = HUNDRED.test(w) ? 100 : THOUSAND.test(w) ? 1000 : LAKH.test(w) ? 100000 : 0;
      if (mult && any) {
        let base = current || 1;
        if (pendingFraction > 0) base = pendingFraction;
        else if (pendingFraction < 0) base = (current || 1) + pendingFraction;       // पावणे दोन = 1.75
        if (sade) base = (current || 1) + 0.5;
        total += base * mult; current = 0; pendingFraction = 0; sade = false; i++; continue;
      }
      break;
    }
    if (any) {
      const value = Math.round((total + current) * 100) / 100;
      if (value > 0) out.push({ start, end: i, value });
    }
    if (i === start) i++;
  }
  return out;
}

// ------------------------------------------------------------------ meaning
const PAY_WORDS = /^(दिले|दिला|दिली|दिलेत|जमा|भरले|भरला|भरली|परत|दिए|दिया|paid|pay|payment|jama|dile|dila|diye|diya|bharle|returned|received|मिळाले|मिळाला|मिले|mile)$/i;
const CREDIT_WORDS = /^(घेतला|घेतले|घेतली|घेतल|उधार|उधारी|बाकी|बाक़ी|बकाया|pending|baki|baaki|udhar|udhari|liya|liye|li|ghetla|ghetle|bought|purchase|purchased|took|credit|due|सामान|किराणा|kirana|saman|samaan|items|ration|bill|बिल)$/i;
const NO_PAY = /(no\s*payment|नो\s*पेमेंट|पैसे\s*(नाही|नहीं)|काही(च)?\s*(नाही|दिले\s*नाही)|nothing\s*paid|not\s*paid|paise\s*nahi|kahi\s*nahi|कुछ\s*नहीं|कुछ\s*नही|उधारीवर|उधार\s*वर|on\s*credit)/i;
const CURRENCY = /^(₹|rs|rupees?|रुपये|रुपया|रुपयाचा|रुपयांचा|रुपयाचे|रुपयांचे|रुपयाची|रु|रुपए|रुपये।|rupaye|rupaya|rupayacha|rupayache|cha|chi|che)$/i;
const ITEM_WORDS = /^(किराणा|kirana|सामान|saman|samaan|दूध|milk|तेल|oil|साखर|sugar|भाजी|bhaji|ration|राशन)$/i;
const PARTICLES = new Set(['यांनी', 'याने', 'हिने', 'ने', 'नी', 'ला', 'ना', 'कडे', 'कडून', 'चा', 'ची', 'चे', 'च्या', 'का', 'की', 'के', 'को', 'से', 'कब', 'आहे', 'आहेत', 'है', 'हैं', 'था', 'थे', 'साठी', 'चं',
  'ne', 'ni', 'la', 'kade', 'kadun', 'ka', 'ki', 'ke', 'ko', 'se', 'kab', 'hai', 'he', 'aahe', 'ahe', 'tha', 'the', 'and', 'ani', 'आणि', 'और', 'aur',
  'has', 'have', 'had', 'is', 'was', 'of', 'for', 'from', 'by', 'to', 'the', 'a', 'mr', 'mrs', 'shri', 'श्री', 'श्रीमती', 'today', 'आज', 'aaj', 'kal', 'काल',
  'कल', 'now', 'आता', 'ab', 'अब', 'ani', 'pan', 'पण', 'लेकिन', 'but', 'ruppee', 'total', 'एकूण', 'only', 'फक्त', 'sirf', 'सिर्फ', 'mhanje', 'म्हणजे',
  'cha', 'chi', 'che', 'chya', 'yanni', 'yani', 'ne', 'pending', 'baki']);

export function parseVoice(text: string, customers: CustomerRow[] = []): VoiceDraft {
  const norm = normalise(text);
  const tokens = norm.split(' ').filter(Boolean);
  const nums = findNumbers(tokens);
  const isNum = new Array<boolean>(tokens.length).fill(false);
  for (const n of nums) for (let k = n.start; k < n.end; k++) isNum[k] = true;

  const near = (n: NumTok, re: RegExp, span = 3) => {
    for (let k = Math.max(0, n.start - span); k < Math.min(tokens.length, n.end + span); k++) if (!isNum[k] && re.test(tokens[k])) return true;
    return false;
  };
  const anyCredit = tokens.some((w) => CREDIT_WORDS.test(w));
  const anyPay = tokens.some((w) => PAY_WORDS.test(w));
  const noPay = NO_PAY.test(norm);

  let intent: Intent = 'credit';
  let amount: number | null = null, paid: number | null = null;
  if (nums.length === 0) {
    intent = anyPay && !anyCredit && !noPay ? 'payment' : 'credit';
  } else if (!anyCredit && anyPay && !noPay) {
    intent = 'payment'; amount = nums[0].value;                          // "सुरेशने 500 जमा केले"
  } else {
    // A purchase; a second amount next to a "paid" word is the money paid now.
    const paidNum = nums.find((n, idx) => idx > 0 && near(n, PAY_WORDS)) ?? (nums.length > 1 && anyPay ? nums[nums.length - 1] : undefined);
    const billNum = nums.find((n) => n !== paidNum) ?? nums[0];
    amount = billNum.value;
    paid = noPay ? 0 : paidNum && paidNum !== billNum ? paidNum.value : anyPay ? null : 0;
    if (paid === null && anyPay) paid = amount;                          // "2000 चा किराणा घेतला, पैसे दिले" → paid in full
  }

  // Name: the words before the first amount/keyword that are not particles; else all leftover words.
  const isKeyword = (w: string) => PAY_WORDS.test(w) || CREDIT_WORDS.test(w) || CURRENCY.test(w) || ITEM_WORDS.test(w)
    || PARTICLES.has(w.toLowerCase()) || w === ',' || /^(no|नो|नाही|नहीं|nahi|payment|पेमेंट|kele|केले|केला|केली|kiya|किया|dena|देणे|देना|lena|घेणे)$/i.test(w);
  const firstStop = tokens.findIndex((w, k) => isNum[k] || (isKeyword(w) && !PARTICLES.has(w.toLowerCase())));
  const head = tokens.slice(0, firstStop < 0 ? tokens.length : firstStop).filter((w) => !isKeyword(w));
  const rest = tokens.filter((w, k) => !isNum[k] && !isKeyword(w));
  const nameWords = (head.length ? head : rest).map((w) => w.replace(/(ने|नी|ला|चा|ची|चे|कडे|यांनी|याने)$/u, '')).filter((w) => w.length > 0);
  const name = nameWords.join(' ').trim();

  const what = intent === 'credit' ? tokens.find((w) => ITEM_WORDS.test(w)) ?? null : null;
  const matches = name ? matchCustomers(name, customers) : [];
  const problems: VoiceDraft['problems'] = [];
  if (amount === null) problems.push('no_amount');
  if (!name) problems.push('no_name');
  const toPaise = (v: number | null) => (v === null ? null : Math.round(v * 100));
  return { text, intent, amountPaise: toPaise(amount), paidPaise: intent === 'credit' ? toPaise(paid) : null, what, name, matches, problems };
}

// ------------------------------------------------------------------ who
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Customers whose name sounds like what was heard, best first (scores 0–1). */
export function matchCustomers(heard: string, customers: CustomerRow[]): { customer: CustomerRow; score: number }[] {
  const hs = skeleton(heard);
  const hWords = hs.split(' ').filter(Boolean);
  if (!hWords.length) return [];
  return customers.filter((c) => c.is_active).map((c) => {
    if (sameName(c.name, heard)) return { customer: c, score: 1 };
    const cWords = skeleton(c.name).split(' ').filter(Boolean);
    // Each heard word against its best customer word; spoken first names alone still match.
    let sum = 0;
    for (const hw of hWords) {
      let best = 0;
      for (const cw of cWords) {
        const d = editDistance(hw, cw);
        best = Math.max(best, 1 - d / Math.max(hw.length, cw.length, 1));
      }
      sum += best;
    }
    const score = (sum / hWords.length) * (hWords.length >= cWords.length ? 1 : 0.92);
    return { customer: c, score: Math.round(score * 100) / 100 };
  }).filter((m) => m.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 4);
}

/** How alike a heard phrase is to a name (0–1), word by word, across Marathi and English spelling. */
export function nameScore(heard: string, name: string): number {
  if (sameName(name, heard)) return 1;
  const hWords = skeleton(heard).split(' ').filter(Boolean);
  const cWords = skeleton(name).split(' ').filter(Boolean);
  if (!hWords.length || !cWords.length) return 0;
  let sum = 0;
  for (const hw of hWords) {
    let best = 0;
    for (const cw of cWords) best = Math.max(best, 1 - editDistance(hw, cw) / Math.max(hw.length, cw.length, 1));
    sum += best;
  }
  return sum / hWords.length;
}
