import { describe, expect, it } from 'vitest';
import { compatibleUnits, formatPaise, lineGrossPaise, parseQty, parseRupees, qtyToText, unitRatio } from '@/lib/money';
import { translate } from '@/lib/i18n';
import { dictionaries, en, mr, type Key } from '@/lib/dictionary';
import { csvMoney, toCsv } from '@/lib/csv';

describe('money parsing (Q)', () => {
  it('converts rupees text to exact paise without floats', () => {
    expect(parseRupees('315')).toEqual({ ok: true, value: 31500 });
    expect(parseRupees('315.5')).toEqual({ ok: true, value: 31550 });
    expect(parseRupees('0.07')).toEqual({ ok: true, value: 7 });
    expect(parseRupees('1,23,456.78')).toEqual({ ok: true, value: 12345678 });
    expect(parseRupees('₹ ३१५.२५')).toEqual({ ok: true, value: 31525 });
    expect(parseRupees('19.99')).toEqual({ ok: true, value: 1999 });   // 19.99*100 is 1998.9999… in floating point
    expect(parseRupees('1.15')).toEqual({ ok: true, value: 115 });
  });
  it('rejects negative, malformed, over-precise and out-of-range amounts', () => {
    expect(parseRupees('-5')).toEqual({ ok: false, error: 'negative' });
    expect(parseRupees('12.345')).toEqual({ ok: false, error: 'too_precise' });
    expect(parseRupees('abc')).toEqual({ ok: false, error: 'malformed' });
    expect(parseRupees('1e5')).toEqual({ ok: false, error: 'malformed' });
    expect(parseRupees('12..5')).toEqual({ ok: false, error: 'malformed' });
    expect(parseRupees('')).toEqual({ ok: false, error: 'empty' });
    expect(parseRupees('0')).toEqual({ ok: false, error: 'out_of_range' });
    expect(parseRupees('0', { allowZero: true })).toEqual({ ok: true, value: 0 });
    expect(parseRupees('1000000001')).toEqual({ ok: false, error: 'out_of_range' });
    expect(parseRupees('9999999999999')).toEqual({ ok: false, error: 'malformed' });
  });
  it('parses quantities to thousandths and rejects more than 3 decimals', () => {
    expect(parseQty('0.5')).toEqual({ ok: true, value: 500 });
    expect(parseQty('१.२५')).toEqual({ ok: true, value: 1250 });
    expect(parseQty('1.2345')).toEqual({ ok: false, error: 'too_precise' });
    expect(parseQty('0')).toEqual({ ok: false, error: 'out_of_range' });
    expect(parseQty('-1')).toEqual({ ok: false, error: 'negative' });
    expect(qtyToText(1250)).toBe('1.25');
    expect(qtyToText(2000)).toBe('2');
    expect(qtyToText(5)).toBe('0.005');
  });
});

describe('units and rounding (S)', () => {
  it('never treats 500 g as 500 kg', () => {
    expect(lineGrossPaise(500_000, 'g', 'kg', 4200)).toBe(2100);       // 500 g at ₹42/kg = ₹21
    expect(lineGrossPaise(500_000, 'kg', 'kg', 4200)).toBe(2_100_000); // 500 kg = ₹21,000
    expect(lineGrossPaise(500, 'kg', 'g', 5)).toBe(2500);              // 0.5 kg at 5 paise/g
  });
  it('rounds half up to the paisa, deterministically', () => {
    expect(lineGrossPaise(250_000, 'ml', 'litre', 11150)).toBe(2788);
    expect(lineGrossPaise(1000, 'piece', 'dozen', 7000)).toBe(583);
    expect(lineGrossPaise(5000, 'piece', 'dozen', 7000)).toBe(2917);
    expect(lineGrossPaise(1, 'kg', 'kg', 499)).toBe(0);
    expect(lineGrossPaise(1, 'kg', 'kg', 500)).toBe(1);
    for (let i = 0; i < 50; i++) expect(lineGrossPaise(333, 'kg', 'kg', 9999)).toBe(3330);
  });
  it('refuses unrelated units', () => {
    expect(unitRatio('g', 'litre')).toBeNull();
    expect(lineGrossPaise(1000, 'packet', 'kg', 100)).toBeNull();
    expect(compatibleUnits('kg')).toEqual(['kg', 'g']);
    expect(compatibleUnits('packet')).toEqual(['packet']);
  });
  it('stays exact for very large values', () => {
    expect(lineGrossPaise(100_000_000, 'kg', 'kg', 1_000_000_000)).toBe(100_000_000_000_000);
  });
});

describe('language and money (L)', () => {
  it('formats with the ₹ sign, Indian grouping and two decimals', () => {
    expect(formatPaise(0)).toBe('₹0.00');
    expect(formatPaise(31500)).toBe('₹315.00');
    expect(formatPaise(12345678)).toBe('₹1,23,456.78');
    expect(formatPaise(1000000000)).toBe('₹1,00,00,000.00');
    expect(formatPaise(99)).toBe('₹0.99');
  });
  it('switching Marathi <-> English never changes an amount', () => {
    for (const paise of [0, 1, 99, 31500, 61500, 12345678, 99999999999]) {
      const inMarathi = `${translate('mr-IN', 'bill.totalDue')} ${formatPaise(paise)}`;
      const inEnglish = `${translate('en-IN', 'bill.totalDue')} ${formatPaise(paise)}`;
      expect(inMarathi.split(' ').at(-1)).toBe(inEnglish.split(' ').at(-1));
      expect(translate('mr-IN', 'pay.tooMuch', { a: formatPaise(paise) })).toContain(formatPaise(paise));
      expect(translate('en-IN', 'pay.tooMuch', { a: formatPaise(paise) })).toContain(formatPaise(paise));
    }
  });
  it('both dictionaries have the same keys and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(mr).sort());
    for (const k of Object.keys(mr) as Key[]) {
      expect(dictionaries['mr-IN'][k].trim(), k).not.toBe('');
      expect(dictionaries['en-IN'][k].trim(), k).not.toBe('');
    }
  });
  it('uses the exact required Marathi labels', () => {
    expect([mr['nav.home'], mr['nav.customers'], mr['nav.newBill'], mr['nav.products'], mr['nav.reports']])
      .toEqual(['मुख्यपृष्ठ', 'ग्राहक', 'नवीन बिल', 'उत्पादने', 'अहवाल']);
    expect([mr['home.greeting'], mr['home.todaySales'], mr['home.todayCollected'], mr['home.totalDue'], mr['home.customersDue']])
      .toEqual(['नमस्कार!', 'आजची विक्री', 'आज जमा झाले', 'एकूण उधारी बाकी', 'बाकी असलेले ग्राहक']);
    expect([mr['home.newBill'], mr['home.scan'], mr['home.addCustomer'], mr['home.receive'], mr['home.recent']])
      .toEqual(['नवीन बिल', 'फोटोवरून बिल', 'ग्राहक जोडा', 'पैसे जमा करा', 'अलीकडील व्यवहार']);
    expect([mr['login.username'], mr['login.password'], mr['login.submit'], mr['login.forgot']])
      .toEqual(['वापरकर्तानाव', 'पासवर्ड', 'लॉगिन करा', 'पासवर्ड विसरलात?']);
    expect([mr['bill.saved'], mr['pay.saved'], mr['sync.offline'], mr['scan.unclear'], mr['bill.checkAmount'], mr['cust.yourDue']])
      .toEqual(['बिल सेव्ह झाले', 'पैसे जमा झाले', 'इंटरनेट उपलब्ध नाही', 'फोटो स्पष्ट नाही', 'कृपया रक्कम तपासा', 'तुमची उधारी बाकी']);
  });
  it('the Marathi interface contains no English words except established terms', () => {
    const allowed = /\b(UPI|CSV|SKU|GST|WhatsApp|SMS|English)\b/g;
    for (const k of Object.keys(mr) as Key[]) {
      if (k === 'c.english') continue;
      const rest = mr[k].replace(allowed, '').replace(/\{[a-z]\}/g, '');
      expect(/[A-Za-z]{2,}/.test(rest), `${k}: ${mr[k]}`).toBe(false);
    }
  });
});

describe('csv export', () => {
  it('quotes, escapes and neutralises formulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'he said "hi"'], ['=SUM(A1)', 5]])).toBe('a,b\r\n"x,y","he said ""hi"""\r\n\'=SUM(A1),5');
    expect(csvMoney(12345678)).toBe('123456.78');
    expect(csvMoney(-500)).toBe('-5.00');
  });
});
