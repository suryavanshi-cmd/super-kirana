import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/api';
import { parseBillCommand, type CmdLine } from '@/lib/voice/billcmd';

const prod = (id: string, name: string, unit: Product['unit'], price: number, name_en: string | null = null): Product =>
  ({ id, name, name_en, name_mr: name, unit, default_price_paise: price, is_active: true, barcode: null, category: null, purchase_cost_paise: null, stock_qty: null, sku: null });
const products = [prod('p1', 'साखर (सुटे)', 'kg', 4600, 'Sugar (loose)'), prod('p2', 'शेंगदाणे (सुटे)', 'kg', 13000, 'Peanuts (loose)'),
  prod('p3', 'तूर डाळ (सुटे)', 'kg', 15000, 'Toor Dal (loose)'), prod('p4', 'जाड पोहे (सुटे)', 'kg', 5500, 'Poha Thick (loose)'), prod('p5', 'पार्ले जी 100 ग्रॅम', 'packet', 1000, 'Parle G 100 g')];
const lines: CmdLine[] = [
  { id: 'a', name: 'साखर (सुटे)', productId: 'p1', unit: 'kg', priceUnit: 'kg' },
  { id: 'b', name: 'शेंगदाणे (सुटे)', productId: 'p2', unit: 'kg', priceUnit: 'kg' },
  { id: 'c', name: 'तूर डाळ (सुटे)', productId: 'p3', unit: 'kg', priceUnit: 'kg' },
];

describe('spoken bill changes', () => {
  it('changes a rate in Marathi, English and Hindi', () => {
    expect(parseBillCommand('साखर 52 रुपये करा', lines, products).ops).toEqual([{ kind: 'price', lineId: 'a', pricePaise: 5200 }]);
    expect(parseBillCommand('साखर 46 ऐवजी 52', lines, products).ops).toEqual([{ kind: 'price', lineId: 'a', pricePaise: 5200 }]);
    expect(parseBillCommand('sugar rate 52', lines, products).ops).toEqual([{ kind: 'price', lineId: 'a', pricePaise: 5200 }]);
    expect(parseBillCommand('sakhar 52 rupees kar do', lines, products).ops).toEqual([{ kind: 'price', lineId: 'a', pricePaise: 5200 }]);
    expect(parseBillCommand('साखर 52 रुपये किलो', lines, products).ops).toEqual([{ kind: 'price', lineId: 'a', pricePaise: 5200 }]);
  });
  it('changes quantities, including grams and fractions', () => {
    expect(parseBillCommand('तूर डाळ 2 किलो', lines, products).ops).toEqual([{ kind: 'qty', lineId: 'c', qty: '2', unit: 'kg' }]);
    expect(parseBillCommand('शेंगदाणे 500 ग्रॅम', lines, products).ops).toEqual([{ kind: 'qty', lineId: 'b', qty: '500', unit: 'g' }]);
    expect(parseBillCommand('साखर अर्धा किलो', lines, products).ops).toEqual([{ kind: 'qty', lineId: 'a', qty: '0.5', unit: 'kg' }]);
    expect(parseBillCommand('साखर 3', lines, products).ops).toEqual([{ kind: 'qty', lineId: 'a', qty: '3', unit: 'kg' }]);
  });
  it('removes lines', () => {
    expect(parseBillCommand('शेंगदाणे काढा', lines, products).ops).toEqual([{ kind: 'remove', lineId: 'b' }]);
    expect(parseBillCommand('remove toor dal', lines, products).ops).toEqual([{ kind: 'remove', lineId: 'c' }]);
  });
  it('adds new items at the shop price', () => {
    const r = parseBillCommand('पोहे 2 किलो जोडा', lines, products);
    expect(r.ops).toEqual([{ kind: 'add', product: products[3], name: 'जाड पोहे (सुटे)', qty: '2', unit: 'kg', pricePaise: 5500 }]);
    expect(parseBillCommand('parle g 3 packet add', lines, products).ops[0]).toMatchObject({ kind: 'add', qty: '3', unit: 'packet', pricePaise: 1000 });
  });
  it('several changes in one sentence', () => {
    expect(parseBillCommand('साखर 52 रुपये आणि तूर डाळ 2 किलो, शेंगदाणे काढा', lines, products).ops).toEqual([
      { kind: 'price', lineId: 'a', pricePaise: 5200 }, { kind: 'qty', lineId: 'c', qty: '2', unit: 'kg' }, { kind: 'remove', lineId: 'b' }]);
  });
  it('reports what it did not understand', () => {
    expect(parseBillCommand('हं हं', lines, products).unknown.length).toBe(1);
  });
});
