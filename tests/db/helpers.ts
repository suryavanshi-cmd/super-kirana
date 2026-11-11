import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

export const pool = new Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54329),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.TEST_DB ?? 'kirana_test',
  max: 30,
});

export type Role = 'authenticated' | 'anon' | 'service_role';

/** Runs fn on a connection that looks to Postgres exactly like a PostgREST request from this user. */
export async function withUser<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, role: Role = 'authenticated'): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(`select set_config('request.jwt.claims', $1, false)`, [userId ? JSON.stringify({ sub: userId, role }) : '{}']);
    await c.query(`set role ${role}`);
    return await fn(c);
  } finally {
    await c.query('reset role').catch(() => {});
    await c.query(`select set_config('request.jwt.claims', '{}', false)`).catch(() => {});
    c.release();
  }
}

/** Calls public.<fn>(named args) as the given user and returns the single result value. */
export async function rpc<T = any>(userId: string | null, fn: string, args: Record<string, unknown> = {}, role: Role = 'authenticated'): Promise<T> {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  const vals = keys.map((k) => {
    const v = args[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  });
  return withUser(userId, async (c) => (await c.query(sql, vals)).rows[0].r as T, role);
}

/** Expects the call to fail with our application error code (the exception message). */
export async function rpcError(userId: string | null, fn: string, args: Record<string, unknown> = {}, role: Role = 'authenticated'): Promise<string> {
  try {
    await rpc(userId, fn, args, role);
  } catch (e: any) {
    return String(e.message);
  }
  return 'NO_ERROR';
}

export async function admin(sql: string, params: unknown[] = []) {
  return pool.query(sql, params);
}

export async function makeUser(prefix = 'u'): Promise<string> {
  const id = randomUUID();
  const name = `${prefix}${id.slice(0, 8)}`;
  await admin(`insert into auth.users(id, email) values ($1, $2)`, [id, `${id}@login.test`]);
  await admin(`insert into public.profiles(user_id, login_username, display_name) values ($1, $2, $3)`, [id, name, name]);
  return id;
}

export interface Fixture { shop: string; owner: string; cashier: string }

export async function makeShop(): Promise<Fixture> {
  const owner = await makeUser('own');
  const cashier = await makeUser('cash');
  const shop = randomUUID();
  await admin(`insert into public.shops(id, shop_username, name_mr, name_en) values ($1, $2, 'चाचणी दुकान', 'Test Shop')`, [shop, `s${shop.slice(0, 10)}`]);
  await admin(`insert into public.shop_members(shop_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'cashier')`, [shop, owner, cashier]);
  return { shop, owner, cashier };
}

export async function makeCustomer(f: Fixture, name = 'ग्राहक', openingPaise = 0): Promise<string> {
  const r = await rpc(f.owner, 'save_customer', { p_shop_id: f.shop, p_customer: { name, opening_balance_paise: openingPaise } });
  return r.id;
}

export const key = () => randomUUID();
export const item = (qty: string, unit: string, pricePaise: number, extra: Record<string, unknown> = {}) =>
  ({ name: 'वस्तू', qty, unit, unit_price_paise: pricePaise, ...extra });

export async function bill(f: Fixture, user: string, customer: string | null, totalPaise: number, paidPaise: number, k = key()) {
  return rpc(user, 'create_invoice', {
    p_shop_id: f.shop, p_idempotency_key: k, p_customer_id: customer,
    p_items: [item('1', 'piece', totalPaise)], p_paid_paise: paidPaise,
  });
}

export async function balance(f: Fixture, customer: string): Promise<number> {
  return Number((await rpc(f.owner, 'get_customer_balance', { p_shop_id: f.shop, p_customer_id: customer })).balance_paise);
}

export async function reconciled(f: Fixture, customer: string): Promise<boolean> {
  return (await rpc(f.owner, 'reconcile_customer_ledger', { p_shop_id: f.shop, p_customer_id: customer })).ok;
}
