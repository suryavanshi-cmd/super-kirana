import { describe, expect, it } from 'vitest';
import data from './fixtures/transcripts.json' with { type: 'json' };
import { indexCustomers } from '../src/parser/match';
import { indexItems, parse } from '../src/parser/parse';

const customers = indexCustomers(data.customers);
const shopItems = indexItems(data.shop_items);

describe(`parser: ${data.cases.length} realistic transcripts`, () => {
  for (const c of data.cases as { text: string; customer: string | null; amount: number | null; type: string | null; items: string[]; missing?: string[] }[]) {
    it(c.text || '(empty)', () => {
      const d = parse(c.text, customers, shopItems);
      expect(d.customer.id, 'customer').toBe(c.customer);
      expect(d.amount, 'amount').toBe(c.amount);
      expect(d.type, 'type').toBe(c.type);
      for (const it of c.items) expect(d.items, 'items').toContain(it);
      if (c.missing) expect([...d.missing].sort()).toEqual([...c.missing].sort());
      expect(d.needs_confirmation).toBe(true);
    });
  }
});

describe('parser behaviour', () => {
  it('offers the top 3 alternatives when the name is ambiguous', () => {
    const d = parse('Patil 200 dile', customers, shopItems);
    expect(d.customer.id).toBeNull();
    expect(d.customer.needs_choice).toBe(true);
    expect(d.customer.alternatives.map((a) => a.id)).toEqual(expect.arrayContaining(['c1', 'c3']));
    expect(d.customer.alternatives.length).toBeLessThanOrEqual(3);
  });
  it('matches a Devanagari spoken name to a Latin stored name and back', () => {
    expect(parse('साक्षी 100 दिले', customers).customer.id).toBe('c5');
    expect(parse('vijay wagh 100 dile', customers).customer.id).toBe('c11');
  });
  it('uses the shop\'s own item names for words it does not know', () => {
    expect(parse('ravi 200 fortune ghetle', customers, shopItems).items).toContain('Fortune Sunflower Oil 1 L');
  });
  it('confidence is high for a clean entry and low when parts are missing', () => {
    expect(parse('Ramesh Patil 250 rupaye sakhar ghetle', customers).overall_confidence).toBeGreaterThan(0.9);
    expect(parse('sakhar', customers).overall_confidence).toBeLessThan(0.3);
  });
  it('parses in well under 10 ms with 2,000 customers', () => {
    const many = indexCustomers(Array.from({ length: 2000 }, (_, i) => ({ id: `x${i}`, name: `Customer ${i} ${['Patil', 'More', 'Jadhav', 'Shinde'][i % 4]}` })));
    parse('Ramesh Patil 250 rupaye sakhar ghetle', many);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) parse('रमेश पाटील दोनशे पन्नास रुपये साखर घेतले', many);
    expect((performance.now() - t0) / 50).toBeLessThan(10);
  });
});
