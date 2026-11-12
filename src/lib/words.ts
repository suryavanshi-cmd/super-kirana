// Amounts in words (Indian system: thousand, lakh, crore), so a shopkeeper can see at a glance
// whether ₹1,250 was typed as ₹12,500. Display only — never used for calculation.
import type { Locale } from './dictionary';

export const MR_0_99 = ('शून्य एक दोन तीन चार पाच सहा सात आठ नऊ दहा अकरा बारा तेरा चौदा पंधरा सोळा सतरा अठरा एकोणीस '
  + 'वीस एकवीस बावीस तेवीस चोवीस पंचवीस सव्वीस सत्तावीस अठ्ठावीस एकोणतीस तीस एकतीस बत्तीस तेहेतीस चौतीस पस्तीस छत्तीस '
  + 'सदतीस अडतीस एकोणचाळीस चाळीस एक्केचाळीस बेचाळीस त्रेचाळीस चव्वेचाळीस पंचेचाळीस सेहेचाळीस सत्तेचाळीस अठ्ठेचाळीस '
  + 'एकोणपन्नास पन्नास एक्कावन्न बावन्न त्रेपन्न चोपन्न पंचावन्न छप्पन्न सत्तावन्न अठ्ठावन्न एकोणसाठ साठ एकसष्ट बासष्ट '
  + 'त्रेसष्ट चौसष्ट पासष्ट सहासष्ट सदुसष्ट अडुसष्ट एकोणसत्तर सत्तर एक्काहत्तर बाहत्तर त्र्याहत्तर चौऱ्याहत्तर पंच्याहत्तर '
  + 'शहात्तर सत्त्याहत्तर अठ्ठ्याहत्तर एकोणऐंशी ऐंशी एक्याऐंशी ब्याऐंशी त्र्याऐंशी चौऱ्याऐंशी पंच्याऐंशी शहाऐंशी '
  + 'सत्त्याऐंशी अठ्ठ्याऐंशी एकोणनव्वद नव्वद एक्याण्णव ब्याण्णव त्र्याण्णव चौऱ्याण्णव पंच्याण्णव शहाण्णव सत्त्याण्णव '
  + 'अठ्ठ्याण्णव नव्व्याण्णव').split(' ');

const EN_0_19 = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const en99 = (n: number): string => (n < 20 ? EN_0_19[n] : EN_TENS[Math.floor(n / 10)] + (n % 10 ? `-${EN_0_19[n % 10]}` : ''));

function mr999(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h === 1) parts.push(r ? 'एकशे' : 'शंभर');
  else if (h > 1) parts.push(`${MR_0_99[h]}शे`);
  if (r) parts.push(MR_0_99[r]);
  return parts.join(' ');
}
function en999(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${EN_0_19[h]} hundred` : '', r ? en99(r) : ''].filter(Boolean).join(' ');
}

/** Whole rupees in words, Indian grouping. 0 ≤ n < 10^12. */
export function rupeesInWords(n: number, locale: Locale): string {
  if (!Number.isSafeInteger(n) || n < 0) return '';
  const mr = locale === 'mr-IN';
  if (n === 0) return mr ? MR_0_99[0] : 'zero';
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1e3), rest = n % 1000;
  const small = (x: number) => (mr ? (x < 100 ? MR_0_99[x] : mr999(x)) : (x < 100 ? en99(x) : en999(x)));
  const parts: string[] = [];
  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore, locale) : small(crore)} ${mr ? 'कोटी' : 'crore'}`);
  if (lakh) parts.push(`${small(lakh)} ${mr ? 'लाख' : 'lakh'}`);
  if (thousand) parts.push(`${small(thousand)} ${mr ? 'हजार' : 'thousand'}`);
  if (rest) parts.push(mr ? mr999(rest) : en999(rest));
  return parts.join(' ');
}

/** "एक हजार दोनशे पन्नास रुपये पन्नास पैसे" / "One thousand two hundred fifty rupees and fifty paise". */
export function paiseInWords(paise: number, locale: Locale): string {
  if (!Number.isSafeInteger(paise) || paise < 0) return '';
  const r = Math.floor(paise / 100), p = paise % 100;
  if (locale === 'mr-IN') return `${rupeesInWords(r, locale)} रुपये${p ? ` ${MR_0_99[p]} पैसे` : ''}`;
  const s = `${rupeesInWords(r, locale)} rupees${p ? ` and ${en99(p)} paise` : ''}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
