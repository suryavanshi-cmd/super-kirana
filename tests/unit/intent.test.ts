import { describe, expect, it } from 'vitest';
import type { CustomerRow } from '@/lib/api';
import { parseIntent } from '@/lib/voice/intent';

const c = (id: string, name: string, balance = 0, mobile: string | null = null): CustomerRow => ({ id, name, mobile, is_active: true, balance_paise: balance });
const customers = [c('c1', 'सुरेश भट', 50000), c('c2', 'हॉटेल अंबरी'), c('c3', 'मीना जाधव', 12000, '9876543210'), c('c4', 'सुरेश पाटील')];

describe('voice anywhere', () => {
  it('opens screens', () => {
    expect(parseIntent('कॅमेरा उघडा', customers)).toEqual({ kind: 'nav', to: '/scan' });
    expect(parseIntent('open camera', customers)).toEqual({ kind: 'nav', to: '/scan' });
    expect(parseIntent('आजचा सारांश दाखवा', customers)).toEqual({ kind: 'nav', to: '/store/summary' });
    expect(parseIntent('show analysis', customers)).toEqual({ kind: 'nav', to: '/store/insights' });
    expect(parseIntent('pending payments', customers)).toEqual({ kind: 'nav', to: '/collect' });
    expect(parseIntent('बाकी यादी दाखवा', customers)).toEqual({ kind: 'nav', to: '/collect' });
    expect(parseIntent('माल आला', customers)).toEqual({ kind: 'nav', to: '/store/stock-in' });
    expect(parseIntent('साठा दाखवा', customers)).toEqual({ kind: 'nav', to: '/store/inventory' });
    expect(parseIntent('नवीन बिल', customers)).toEqual({ kind: 'nav', to: '/bill' });
  });
  it('fills in a new customer', () => {
    expect(parseIntent('नवीन ग्राहक रमेश पाटील 98765 43219', customers)).toEqual({ kind: 'newCustomer', name: 'रमेश पाटील', mobile: '9876543219', openingPaise: null });
    expect(parseIntent('add new customer Ganesh More mobile 9822012345', customers)).toMatchObject({ kind: 'newCustomer', name: 'Ganesh More', mobile: '9822012345' });
  });
  it('fills in a customer change', () => {
    const r = parseIntent('मीना जाधवचा मोबाईल 9822012345 करा', customers);
    expect(r).toMatchObject({ kind: 'editCustomer', newMobile: '9822012345', newName: null });
    expect(r.kind === 'editCustomer' && r.customer?.id).toBe('c3');
    const n = parseIntent('hotel ambari name change hotel ambari palace', customers);
    expect(n).toMatchObject({ kind: 'editCustomer', newName: 'hotel ambari palace' });
    expect(n.kind === 'editCustomer' && n.customer?.id).toBe('c2');
  });
  it('opens a customer and records entries', () => {
    const o = parseIntent('सुरेश भटचे खाते दाखवा', customers);
    expect(o.kind === 'openCustomer' && o.customer?.id).toBe('c1');
    const e = parseIntent('सुरेश भट यांनी 2,000 रुपयाचा किराणा घेतला, नो पेमेंट', customers);
    expect(e.kind).toBe('entry');
  });
});
