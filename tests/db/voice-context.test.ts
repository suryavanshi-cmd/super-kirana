// svc_voice_context: membership enforced, only names/ids returned, deleted customers hidden.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bill, makeCustomer, makeShop, pool, type Fixture } from './helpers';

let f: Fixture;
beforeAll(async () => { f = await makeShop(); });
afterAll(async () => { await pool.end(); });

const ctx = async (user: string, shop: string | null) => (await pool.query('select public.svc_voice_context($1, $2) as r', [user, shop])).rows[0].r;

describe('svc_voice_context', () => {
  it('returns customers (recent first) and item names for a member', async () => {
    const a = await makeCustomer(f, 'रमेश पाटील');
    const b = await makeCustomer(f, 'सुनीता ताई');
    await bill(f, f.cashier, b, 5000, 0);
    const r = await ctx(f.owner, f.shop);
    expect(r.shop_id).toBe(f.shop);
    const ids = r.customers.map((c: { id: string }) => c.id);
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a));
    expect(Object.keys(r.customers[0]).sort()).toEqual(['id', 'name']);
    expect(Array.isArray(r.items)).toBe(true);
  });
  it('picks the only shop when none is given, and refuses outsiders', async () => {
    expect((await ctx(f.cashier, null)).shop_id).toBe(f.shop);
    const other = await makeShop();
    await expect(ctx(other.owner, f.shop)).rejects.toThrow(/FORBIDDEN/);
  });
  it('is not callable by signed-in users directly', async () => {
    const r = await pool.query("select has_function_privilege('authenticated', 'public.svc_voice_context(uuid, uuid)', 'execute') as ok");
    expect(r.rows[0].ok).toBe(false);
  });
});
