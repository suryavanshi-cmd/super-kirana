// Deleting a customer: owner only, balance must be ₹0, records kept, hidden from lists, no new bills.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bill, makeCustomer, makeShop, pool, rpc, rpcError, type Fixture } from './helpers';

let f: Fixture;
beforeAll(async () => { f = await makeShop(); });
afterAll(async () => { await pool.end(); });

describe('delete customer', () => {
  it('refuses while money is due, and for a cashier', async () => {
    const c = await makeCustomer(f, 'देणेकरी', 50000);
    expect(await rpcError(f.owner, 'delete_customer', { p_shop_id: f.shop, p_customer_id: c })).toBe('BALANCE_NOT_ZERO');
    const z = await makeCustomer(f, 'शून्य');
    expect(await rpcError(f.cashier, 'delete_customer', { p_shop_id: f.shop, p_customer_id: z })).toBe('OWNER_ONLY');
  });

  it('at ₹0: hidden from the list, history kept, no new bills', async () => {
    const c = await makeCustomer(f, 'चुकता');
    const r = await bill(f, f.cashier, c, 31500, 31500);            // fully paid bill → balance 0
    await rpc(f.owner, 'delete_customer', { p_shop_id: f.shop, p_customer_id: c });
    const list = await rpc<{ id: string }[]>(f.owner, 'list_customers', { p_shop_id: f.shop });
    expect(list.some((x) => x.id === c)).toBe(false);
    const inv = await rpc(f.owner, 'get_invoice', { p_shop_id: f.shop, p_invoice_id: r.invoice_id });
    expect(inv.total_paise).toBe(31500);                              // the old bill is still there
    await expect(bill(f, f.cashier, c, 1000, 0)).rejects.toThrow(/CUSTOMER_INACTIVE/);
    expect(await rpcError(f.owner, 'delete_customer', { p_shop_id: f.shop, p_customer_id: c })).toBe('CUSTOMER_NOT_FOUND');
  });
});
