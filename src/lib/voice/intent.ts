// What did the shopkeeper ask for? One spoken sentence, anywhere in the app, in Marathi / Hindi /
// English. Understood on the phone itself (instant, nothing sent anywhere), then the app opens the
// right screen already filled in. Nothing is ever saved from here: every change is confirmed on the
// normal screen.
//
//   "कॅमेरा उघडा"                          → photo bill
//   "आजचा सारांश दाखवा" / "analysis"        → summary / analysis
//   "बाकी यादी" / "pending payments"        → who owes money
//   "नवीन ग्राहक रमेश पाटील 9876543210"     → new-customer form, filled in
//   "सुरेश पाटीलचा मोबाईल 9822012345 करा"   → that customer's edit form, filled in
//   "सुरेश भटचे खाते दाखवा"                → that customer's page
//   "सुरेश भट 2000 किराणा नो पेमेंट"         → credit bill screen, filled in
import type { CustomerRow } from '../api';
import { matchCustomers, normalise, parseVoice, type VoiceDraft } from './parse';

export type Screen = '/home' | '/scan' | '/bill' | '/udhari' | '/collect' | '/customers' | '/store' | '/store/summary' | '/store/insights'
  | '/store/inventory' | '/store/stock-in' | '/store/catalog' | '/reports' | '/settings' | '/voice' | '/customers/new' | '/sync';
export type Intent =
  | { kind: 'nav'; to: Screen }
  | { kind: 'newCustomer'; name: string; mobile: string | null; openingPaise: number | null }
  | { kind: 'editCustomer'; customer: CustomerRow | null; candidates: CustomerRow[]; heardName: string; newName: string | null; newMobile: string | null }
  | { kind: 'openCustomer'; customer: CustomerRow | null; candidates: CustomerRow[]; heardName: string }
  | { kind: 'entry'; draft: VoiceDraft }
  | { kind: 'unknown' };

// Screen words. Longer / more specific phrases first.
const NAV: [RegExp, Screen][] = [
  [/(माल\s*आला|माल\s*आलाय|goods\s*(received|aaya|aala)|stock\s*in|खरेदी\s*नोंद|purchase\s*entry|माल\s*नोंद)/i, '/store/stock-in'],
  [/(तयार\s*यादी|ready\s*list|catalog(ue)?|वस्तू\s*यादी\s*जोड|product\s*list)/i, '/store/catalog'],
  [/(साठा|स्टॉक|stock|inventory|माल\s*शिल्लक|माझा\s*माल|maal\s*shillak)/i, '/store/inventory'],
  [/(विश्लेषण|analysis|analytics|चार्ट|chart|graph|ग्राफ|trend|ट्रेंड|कोणी\s*जास्त|best\s*sell|top\s*customer)/i, '/store/insights'],
  [/(सारांश|summary|हिशोब\s*सांग|आजचा\s*हिशोब|aaj\s*ka\s*hisab|today'?s?\s*(sale|business))/i, '/store/summary'],
  [/(दुकान\s*हिशोब|dukan\s*hishob|shop\s*accounts?)/i, '/store'],
  [/(अहवाल|report)/i, '/reports'],
  [/(कॅमेरा|कॅमेरे|camera|कैमरा|फोटो|photo|स्कॅन|scan|यादीचा\s*फोटो)/i, '/scan'],
  [/(बाकी\s*(यादी|असलेले|लोक|ग्राहक)|थकबाकी|pending(\s*payments?|\s*list)?|dues|बकाया|उधारी\s*यादी|कोणाकडे\s*बाकी|baki\s*list)/i, '/collect'],
  [/(पैसे\s*जमा|payment\s*receive|receive\s*payment|वसूल|jama\s*kar)/i, '/collect'],
  [/(नवीन\s*बिल|new\s*bill|बिल\s*(बनवा|करा|तयार)|bill\s*banao|वस्तूनुसार\s*बिल)/i, '/bill'],
  [/(उधारी\s*नोंद|udhari|credit\s*bill)/i, '/udhari'],
  [/(ग्राहक\s*(यादी|सगळे|सर्व|दाखवा)|customers?\s*(list)?$|all\s*customers|ग्राहकांची\s*यादी)/i, '/customers'],
  [/(सेटिंग|setting|भाषा\s*बदल|language)/i, '/settings'],
  [/(सिंक|sync)/i, '/sync'],
  [/(मुख्य\s*पान|होम|home|मुख्यपृष्ठ)/i, '/home'],
];
const NEW_CUSTOMER = /(नवीन\s*ग्राहक|नवा\s*ग्राहक|ग्राहक\s*जोड|new\s*customer|add\s*customer|customer\s*add|naya\s*customer|नया\s*ग्राहक|grahak\s*jod)/i;
const EDIT = /(बदला|बदल|बदलून|update|change|दुरुस्त|सुधार|edit|badlo|badla|करा|kara|karo|करो)/i;
const FIELD_MOBILE = /(मोबाईल|मोबाइल|mobile|नंबर|number|फोन|phone|nambar)/i;
const FIELD_NAME = /(नाव|naav|naam|नाम|name)/i;
const OPEN_CUSTOMER = /(खाते|khata|खाता|account|हिशोब|दाखवा|उघडा|open|show|dikhao|dakhva|ledger)/i;
const MOBILE = /(?:\+?91[\s-]?)?([6-9](?:[\s-]?\d){9})\b/;

const STRIP = /(नवीन|नवा|ग्राहक|जोडा|जोड|new|customer|add|naya|नया|grahak|jod|मोबाईल|मोबाइल|mobile|नंबर|number|फोन|phone|nambar|नाव|naav|naam|नाम|name|बदला|बदल|बदलून|update|change|दुरुस्त|सुधार|edit|badlo|badla|करा|kara|karo|करो|खाते|khata|खाता|account|दाखवा|उघडा|open|show|dikhao|dakhva|ledger|चा|ची|चे|चं|का|की|के|ला|यांचा|यांची|यांचे|आहे|है|ahe|of|the|to|his|her|its|असा|ठेवा|आणि|and|से|में|मध्ये|ऐवजी|instead|बाकी|उधार|opening|जुनी|old|due|dues)$/i;
const cleanName = (words: string[]) => words.map((w) => w.replace(/(चा|ची|चे|चं|ला|ने|नी|यांचा|यांची|यांचे|च्या)$/u, '')).filter((w) => w && !STRIP.test(w) && !/^[\d,]+$/.test(w)).join(' ').trim();

function digitsOf(m: RegExpMatchArray | null): string | null {
  return m ? m[1].replace(/\D/g, '') : null;
}

/** Customer named somewhere in the words before a field word ("सुरेश पाटीलचा मोबाईल …"). */
function findCustomer(words: string[], customers: CustomerRow[]) {
  const heard = cleanName(words);
  const matches = heard ? matchCustomers(heard, customers) : [];
  const top = matches[0];
  const clear = top && ((top.score >= 0.85 && (matches.length === 1 || top.score - matches[1].score >= 0.15)) || (matches.length === 1 && top.score >= 0.75)) ? top.customer : null;
  return { heard, customer: clear, candidates: matches.map((m) => m.customer).slice(0, 4) };
}

export function parseIntent(text: string, customers: CustomerRow[]): Intent {
  const raw = text.normalize('NFC').trim();
  if (!raw) return { kind: 'unknown' };
  const norm = normalise(raw);
  const words = norm.split(' ').filter((w) => w && w !== ',');
  const mobile = digitsOf(raw.match(MOBILE)) ?? digitsOf(norm.match(MOBILE));

  // 1) New customer, with whatever details were said.
  if (NEW_CUSTOMER.test(raw)) {
    const rest = words.filter((w) => !(mobile && w.replace(/\D/g, '') && mobile.includes(w.replace(/\D/g, ''))));
    const draft = parseVoice(raw.replace(MOBILE, ' '), []);
    return { kind: 'newCustomer', name: cleanName(rest).slice(0, 120), mobile, openingPaise: /(बाकी|उधार|opening|due|जुनी)/i.test(raw) ? draft.amountPaise : null };
  }

  // 2) Change a customer's mobile or name.
  const fieldAt = words.findIndex((w) => FIELD_MOBILE.test(w) || FIELD_NAME.test(w));
  if (fieldAt > 0 && (EDIT.test(raw) || mobile)) {
    const { heard, customer, candidates } = findCustomer(words.slice(0, fieldAt), customers);
    if (heard) {
      const isMobile = FIELD_MOBILE.test(words[fieldAt]);
      const after = words.slice(fieldAt + 1);
      const newName = !isMobile ? cleanName(after) || null : null;
      return { kind: 'editCustomer', customer, candidates, heardName: heard, newName, newMobile: isMobile ? mobile : null };
    }
  }

  // 3) A screen.
  for (const [re, to] of NAV) {
    if (!re.test(raw)) continue;
    // "सुरेशची बाकी" is about one customer, not the dues list.
    if (to === '/collect' || to === '/customers') {
      const who = findCustomer(words, customers);
      if (who.customer && !/(यादी|list|सगळे|सर्व|all)/i.test(raw)) return { kind: 'openCustomer', customer: who.customer, candidates: who.candidates, heardName: who.heard };
    }
    return { kind: 'nav', to };
  }

  // 4) Credit or payment for a customer ("सुरेश 2000 किराणा नो पेमेंट").
  const entry = parseVoice(raw, customers);
  if (entry.amountPaise !== null && entry.name) return { kind: 'entry', draft: entry };

  // 5) Open a customer's account.
  if (OPEN_CUSTOMER.test(raw) || words.length <= 3) {
    const who = findCustomer(words, customers);
    if (who.candidates.length) return { kind: 'openCustomer', customer: who.customer, candidates: who.candidates, heardName: who.heard };
  }
  return { kind: 'unknown' };
}
