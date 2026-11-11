import { describe, expect, it } from 'vitest';
import { isResolved, parseLine, parseText } from '@/lib/ocr/parse';
import { applyCatalogue, matchProducts, similarity } from '@/lib/ocr/match';
import type { Product } from '@/lib/api';

const product = (id: string, name: string, unit: Product['unit'], price: number, extra: Partial<Product> = {}): Product =>
  ({ id, name, name_en: null, name_mr: null, unit, default_price_paise: price, is_active: true, barcode: null, category: null, purchase_cost_paise: null, stock_qty: null, sku: null, ...extra });
const catalogue = [
  product('p1', 'साखर', 'kg', 4200, { name_en: 'Sugar' }),
  product('p2', 'शेंगदाणा तेल', 'litre', 18000, { name_en: 'Groundnut Oil' }),
  product('p3', 'Parle-G', 'packet', 1000, { name_mr: 'पार्ले जी' }),
  product('p4', 'तांदूळ', 'kg', 6000, { name_en: 'Rice', is_active: false }),
];

describe('OCR line parsing', () => {
  it('reads Marathi, English and mixed lines with quantity and unit', () => {
    expect(parseLine('साखर २ किलो')).toMatchObject({ name: 'साखर', qtyText: '2', unit: 'kg', unitPricePaise: null });
    expect(parseLine('Sugar 2 kg')).toMatchObject({ name: 'Sugar', qtyText: '2', unit: 'kg' });
    expect(parseLine('1. तेल 500ml')).toMatchObject({ name: 'तेल', qtyText: '500', unit: 'ml' });
    expect(parseLine('Parle-G 3 pkt')).toMatchObject({ name: 'Parle-G', qtyText: '3', unit: 'packet' });
    expect(parseLine('अर्धा किलो रवा')).toMatchObject({ name: 'रवा', qtyText: '0.5', unit: 'kg' });
    expect(parseLine('दूध दीड लिटर')).toMatchObject({ name: 'दूध', qtyText: '1.5', unit: 'litre' });
    expect(parseLine('अंडी 1 डझन')).toMatchObject({ name: 'अंडी', qtyText: '1', unit: 'dozen' });
  });

  it('reads explicit rates and totals written the way shopkeepers write them', () => {
    expect(parseLine('साखर 2 किलो @ 42')).toMatchObject({ qtyText: '2', unit: 'kg', unitPricePaise: 4200, lineTotalPaise: null });
    expect(parseLine('साखर 2 किलो @ 42 = 84')).toMatchObject({ unitPricePaise: 4200, lineTotalPaise: 8400, flags: [] });
    expect(parseLine('Oil 1 ltr 140/-')).toMatchObject({ qtyText: '1', unit: 'litre', unitPricePaise: 14000 });
    expect(parseLine('तेल 2 लिटर x 140 = 280')).toMatchObject({ unitPricePaise: 14000, lineTotalPaise: 28000 });
    expect(parseLine('डाळ 1 किलो ₹ 1,250.50')).toMatchObject({ unitPricePaise: 125050 });
  });

  it('never invents a missing price', () => {
    const it1 = parseLine('साखर 2 किलो')!;
    expect(it1.unitPricePaise).toBeNull();
    expect(it1.lineTotalPaise).toBeNull();
    expect(it1.flags).toContain('price_missing');
    expect(isResolved({ ...it1, reviewed: true })).toBe(false);
  });

  it('flags a number that could be either the rate or the line total', () => {
    const x = parseLine('साखर 2 किलो 90')!;
    expect(x.unitPricePaise).toBeNull();
    expect(x.ambiguousAmountPaise).toBe(9000);
    expect(x.flags).toContain('ambiguous_amount');
    expect(isResolved({ ...x, reviewed: true })).toBe(false);
  });

  it('flags a written total that disagrees with rate × quantity', () => {
    expect(parseLine('साखर 2 किलो @ 42 = 90')!.flags).toContain('total_mismatch');
  });

  it('flags missing quantity or unit and low confidence', () => {
    expect(parseLine('बिस्किट')!.flags).toEqual(expect.arrayContaining(['qty_missing', 'unit_missing', 'price_missing']));
    expect(parseLine('बिस्किट 3')).toMatchObject({ qtyText: '3', unit: null });
    expect(parseLine('साखर 2 किलो', 41)!.flags).toContain('low_confidence');
  });

  it('skips blank and decoration lines; parses a whole list', () => {
    expect(parseLine('-----')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    const items = parseText('किराणा यादी\n\nसाखर 2 किलो\nतेल 1 लिटर 140\n----\nParle-G 3 pkt');
    expect(items.map((i) => i.name)).toEqual(['किराणा यादी', 'साखर', 'तेल', 'Parle-G']);
    expect(items.every((i) => !i.reviewed)).toBe(true);
  });
});

describe('catalogue matching', () => {
  it('matches by Marathi or English name, tolerating small OCR mistakes', () => {
    expect(matchProducts('Sugar', catalogue)[0].product.id).toBe('p1');
    expect(matchProducts('साखर', catalogue)[0].product.id).toBe('p1');
    expect(matchProducts('साखऱ', catalogue)[0].product.id).toBe('p1');
    expect(matchProducts('groundnut oi1', catalogue)[0].product.id).toBe('p2');
    expect(matchProducts('पार्ले जी', catalogue)[0].product.id).toBe('p3');
    expect(matchProducts('xyz unknown', catalogue)).toEqual([]);
    expect(matchProducts('Rice', catalogue)).toEqual([]);          // inactive products are not suggested
    expect(similarity('', 'x')).toBe(0);
  });

  it('suggests the saved price as a suggestion that still needs acceptance', () => {
    const x = applyCatalogue(parseLine('साखर 2 किलो')!, catalogue);
    expect(x.productId).toBe('p1');
    expect(x.unitPricePaise).toBe(4200);
    expect(x.flags).toContain('price_from_catalogue');
    expect(x.flags).not.toContain('price_missing');
    expect(x.reviewed).toBe(false);
    expect(isResolved(x)).toBe(false);
    expect(isResolved({ ...x, reviewed: true })).toBe(true);
  });

  it('prices 500 g at the per-kg catalogue rate, never as 500 kg, and never overrides a written price', () => {
    const grams = applyCatalogue(parseLine('साखर 500 ग्रॅम')!, catalogue);
    expect(grams).toMatchObject({ qtyText: '500', unit: 'g', priceUnit: 'kg', unitPricePaise: 4200 });
    expect(grams.flags).toContain('price_from_catalogue');
    const packets = applyCatalogue(parseLine('साखर 2 पाकीट')!, catalogue);
    expect(packets.unitPricePaise).toBeNull();                      // packets cannot be priced per kg
    expect(packets.flags).toContain('price_missing');
    const written = applyCatalogue(parseLine('साखर 2 किलो @ 45')!, catalogue);
    expect(written.unitPricePaise).toBe(4500);
    expect(written.flags).not.toContain('price_from_catalogue');
    const ambiguous = applyCatalogue(parseLine('साखर 2 किलो 90')!, catalogue);
    expect(ambiguous.unitPricePaise).toBeNull();
    const noUnit = applyCatalogue(parseLine('Parle-G 3')!, catalogue);
    expect(noUnit).toMatchObject({ qtyText: '3', unit: 'packet', unitPricePaise: 1000 });
  });

  it('marks items that are not in the catalogue', () => {
    expect(applyCatalogue(parseLine('केशर 1 ग्रॅम')!, catalogue).flags).toContain('unmatched');
  });
});
