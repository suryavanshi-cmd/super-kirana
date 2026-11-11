// Tenant isolation, roles, sessions and onboarding (spec 18 O/P + multi-shop section 10).
// Access is attempted directly at the database/API layer, not through the UI.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, balance, bill, item, key, makeCustomer, makeShop, makeUser, pool, rpc, rpcError, withUser, type Fixture } from './helpers';

let a: Fixture, b: Fixture;
let custA: string, custB: string, prodB: string, invB: string, payB: string;

beforeAll(async () => {
  a = await makeShop();
  b = await makeShop();
  custA = await makeCustomer(a, 'A ग्राहक', 50000);
  custB = await makeCustomer(b, 'B ग्राहक', 70000);
  prodB = (await rpc(b.owner, 'save_product', { p_shop_id: b.shop, p_product: { name: 'तांदूळ', unit: 'kg', default_price_paise: 6000 } })).id;
  const r = await bill(b, b.cashier, custB, 31500, 20000);
  invB = r.invoice_id;
  payB = r.payment_ids[0];
});
afterAll(async () => { await pool.end(); });

const TABLES = ['customers', 'customer_balances', 'products', 'invoices', 'invoice_items', 'payments', 'credit_notes',
  'payment_allocations', 'ledger_entries', 'ocr_jobs', 'audit_events', 'client_mutations'];

describe('row level security: direct table access', () => {
  it('O: shop A users read zero rows of shop B from every business table', async () => {
    for (const user of [a.owner, a.cashier]) {
      await withUser(user, async (c) => {
        for (const t of TABLES) {
          const r = await c.query(`select count(*)::int n from public.${t} where shop_id = $1`, [b.shop]);
          expect(r.rows[0].n, `${t} visible across shops`).toBe(0);
        }
        expect((await c.query(`select count(*)::int n from public.shops where id = $1`, [b.shop])).rows[0].n).toBe(0);
        expect((await c.query(`select count(*)::int n from public.shop_members where shop_id = $1`, [b.shop])).rows[0].n).toBe(0);
        expect((await c.query(`select count(*)::int n from public.profiles where user_id = $1`, [b.owner])).rows[0].n).toBe(0);
        expect((await c.query(`select count(*)::int n from public.customers`)).rows[0].n).toBeGreaterThan(0);
      });
    }
  });

  it('P: no role can write ledger or any other table directly', async () => {
    await withUser(a.owner, async (c) => {
      const writes = [
        `insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, business_date, created_by) values ('${b.shop}', '${custB}', 'opening_balance', -70000, current_date, '${a.owner}')`,
        `insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, business_date, created_by) values ('${a.shop}', '${custA}', 'opening_balance', -50000, current_date, '${a.owner}')`,
        `update public.customer_balances set balance_paise = 0 where customer_id = '${custA}'`,
        `update public.invoices set status = 'reversed', reversed_at = now() where id = '${invB}'`,
        `delete from public.payments where shop_id = '${a.shop}'`,
        `insert into public.customers(shop_id, name, created_by) values ('${b.shop}', 'x', '${a.owner}')`,
        `update public.shop_members set role = 'owner' where user_id = '${a.cashier}'`,
        `insert into public.platform_admins(user_id) values ('${a.owner}')`,
        `update public.profiles set must_change_password = false where user_id = '${a.owner}'`,
      ];
      for (const sql of writes) await expect(c.query(sql), sql).rejects.toThrow(/permission denied/);
      await expect(c.query(`select * from public.auth_throttle`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`select * from public.platform_setup`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`select app_private.balance_of('${custB}')`)).rejects.toThrow(/permission denied/);
    });
  });

  it('anonymous callers can read nothing and execute nothing', async () => {
    await withUser(null, async (c) => {
      await expect(c.query(`select * from public.customers`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`select public.my_context()`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`select public.svc_resolve_login('x')`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`select public.list_customers('${a.shop}')`)).rejects.toThrow(/permission denied/);
    }, 'anon');
    await withUser(a.owner, async (c) => {
      await expect(c.query(`select public.svc_resolve_login('x')`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`select public.svc_complete_setup('c', '${a.owner}', 'u', 'n')`)).rejects.toThrow(/permission denied/);
    });
  });
});

describe('functions refuse cross-shop references', () => {
  it('shop A cannot read shop B through any RPC', async () => {
    for (const [fn, args] of [
      ['list_customers', { p_shop_id: b.shop }],
      ['list_products', { p_shop_id: b.shop }],
      ['get_customer', { p_shop_id: b.shop, p_customer_id: custB }],
      ['get_customer_ledger', { p_shop_id: b.shop, p_customer_id: custB }],
      ['get_invoice', { p_shop_id: b.shop, p_invoice_id: invB }],
      ['get_payment', { p_shop_id: b.shop, p_payment_id: payB }],
      ['get_shop_daily_summary', { p_shop_id: b.shop }],
      ['get_report', { p_shop_id: b.shop, p_from: '2026-01-01', p_to: '2026-12-31' }],
      ['get_outstanding_report', { p_shop_id: b.shop }],
      ['list_recent_activity', { p_shop_id: b.shop }],
      ['list_members', { p_shop_id: b.shop }],
      ['list_audit', { p_shop_id: b.shop }],
      ['reconcile_shop', { p_shop_id: b.shop }],
    ] as const) {
      expect(await rpcError(a.owner, fn, args), fn).toBe('FORBIDDEN');
    }
  });

  it('shop A cannot smuggle shop B ids through its own shop id', async () => {
    expect(await rpcError(a.owner, 'get_customer', { p_shop_id: a.shop, p_customer_id: custB })).toBe('CUSTOMER_NOT_FOUND');
    expect(await rpcError(a.owner, 'get_invoice', { p_shop_id: a.shop, p_invoice_id: invB })).toBe('INVOICE_NOT_FOUND');
    expect(await rpcError(a.owner, 'get_payment', { p_shop_id: a.shop, p_payment_id: payB })).toBe('PAYMENT_NOT_FOUND');
    expect(await rpcError(a.owner, 'receive_payment', { p_shop_id: a.shop, p_idempotency_key: key(), p_customer_id: custB, p_amount_paise: 100 })).toBe('CUSTOMER_NOT_FOUND');
    expect(await rpcError(a.owner, 'receive_payment', { p_shop_id: b.shop, p_idempotency_key: key(), p_customer_id: custB, p_amount_paise: 100 })).toBe('FORBIDDEN');
    expect(await rpcError(a.owner, 'create_invoice', { p_shop_id: a.shop, p_idempotency_key: key(), p_customer_id: custB, p_items: [item('1', 'piece', 100)], p_paid_paise: 0 })).toBe('CUSTOMER_NOT_FOUND');
    expect(await rpcError(a.owner, 'create_invoice', { p_shop_id: a.shop, p_idempotency_key: key(), p_customer_id: custA, p_items: [{ product_id: prodB, qty: '1', unit: 'kg', unit_price_paise: 6000 }], p_paid_paise: 0 })).toBe('PRODUCT_NOT_FOUND');
    expect(await rpcError(a.owner, 'reverse_invoice', { p_shop_id: a.shop, p_idempotency_key: key(), p_invoice_id: invB, p_reason: 'attack' })).toBe('INVOICE_NOT_FOUND');
    expect(await rpcError(a.owner, 'reverse_payment', { p_shop_id: a.shop, p_idempotency_key: key(), p_payment_id: payB, p_reason: 'attack' })).toBe('PAYMENT_NOT_FOUND');
    expect(await rpcError(a.owner, 'issue_credit_or_return', { p_shop_id: a.shop, p_idempotency_key: key(), p_customer_id: custA, p_amount_paise: 100, p_reason: 'attack', p_invoice_id: invB })).toBe('INVOICE_NOT_FOUND');
    expect(await rpcError(a.owner, 'save_customer', { p_shop_id: a.shop, p_customer: { id: custB, name: 'hijack' } })).toBe('CUSTOMER_NOT_FOUND');
    expect(await rpcError(a.owner, 'save_product', { p_shop_id: a.shop, p_product: { id: prodB, name: 'hijack', unit: 'kg', default_price_paise: 1 } })).toBe('PRODUCT_NOT_FOUND');
    expect(await rpcError(a.owner, 'set_member', { p_shop_id: a.shop, p_user_id: b.cashier, p_role: 'cashier', p_status: 'disabled' })).toBe('MEMBER_NOT_FOUND');
    expect(await rpcError(a.owner, 'get_mutation_status', { p_shop_id: b.shop, p_idempotency_key: key() })).toBe('FORBIDDEN');
  });

  it('composite foreign keys reject cross-shop rows even for the table owner', async () => {
    await expect(admin(
      `insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, business_date, created_by) values ($1, $2, 'opening_balance', 100, current_date, $3)`,
      [a.shop, custB, a.owner])).rejects.toThrow(/foreign key/);
    await expect(admin(
      `insert into public.payment_allocations(shop_id, customer_id, payment_id, target, invoice_id, amount_paise) values ($1, $2, $3, 'invoice', $4, 1)`,
      [a.shop, custA, payB, invB])).rejects.toThrow(/foreign key/);
  });

  it('balances and reports stay isolated per shop', async () => {
    const beforeB = await rpc(b.owner, 'get_shop_daily_summary', { p_shop_id: b.shop });
    await bill(a, a.cashier, custA, 99900, 0);
    await rpc(a.cashier, 'receive_payment', { p_shop_id: a.shop, p_idempotency_key: key(), p_customer_id: custA, p_amount_paise: 12300 });
    const afterB = await rpc(b.owner, 'get_shop_daily_summary', { p_shop_id: b.shop });
    expect(afterB).toEqual(beforeB);
    expect(await balance(b, custB)).toBe(70000 + 11500);
    const sa = await rpc(a.owner, 'get_shop_daily_summary', { p_shop_id: a.shop });
    const ledgerA = Number((await admin(`select sum(amount_paise) v from public.ledger_entries where shop_id = $1 and customer_id is not null`, [a.shop])).rows[0].v);
    expect(sa.total_outstanding_paise).toBe(ledgerA);
    expect((await rpc(a.owner, 'reconcile_shop', { p_shop_id: a.shop })).ok).toBe(true);
    expect((await rpc(b.owner, 'reconcile_shop', { p_shop_id: b.shop })).ok).toBe(true);
  });
});

describe('roles, sessions and status', () => {
  it('a disabled cashier is blocked immediately, even with an old session', async () => {
    const s = await makeShop();
    const c = await makeCustomer(s, 'x', 10000);
    await admin(`insert into auth.sessions(user_id) values ($1)`, [s.cashier]);
    await rpc(s.cashier, 'receive_payment', { p_shop_id: s.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: 100 });
    await rpc(s.owner, 'set_member', { p_shop_id: s.shop, p_user_id: s.cashier, p_role: 'cashier', p_status: 'disabled' });
    // Same user id = same still-valid JWT as far as the database can tell.
    expect(await rpcError(s.cashier, 'receive_payment', { p_shop_id: s.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: 100 })).toBe('FORBIDDEN');
    expect(await rpcError(s.cashier, 'create_invoice', { p_shop_id: s.shop, p_idempotency_key: key(), p_customer_id: null, p_items: [item('1', 'piece', 100)], p_paid_paise: 100 })).toBe('FORBIDDEN');
    expect(await rpcError(s.cashier, 'list_customers', { p_shop_id: s.shop })).toBe('FORBIDDEN');
    await withUser(s.cashier, async (cl) => {
      expect((await cl.query(`select count(*)::int n from public.customers`)).rows[0].n).toBe(0);
    });
    expect((await admin(`select count(*)::int n from auth.sessions where user_id = $1`, [s.cashier])).rows[0].n).toBe(0);
    expect((await rpc(s.cashier, 'my_context')).shops).toEqual([]);
    expect(await balance(s, c)).toBe(9900);
  });

  it('a forced password change blocks all shop access until it is done', async () => {
    const s = await makeShop();
    await admin(`update public.profiles set must_change_password = true where user_id = $1`, [s.cashier]);
    expect(await rpcError(s.cashier, 'list_customers', { p_shop_id: s.shop })).toBe('FORBIDDEN');
    const ctx = await rpc(s.cashier, 'my_context');
    expect(ctx.must_change_password).toBe(true);
    expect(ctx.shops).toEqual([]);
  });

  it('a suspended shop is closed to its members at once, and reopens when the admin updates it', async () => {
    const s = await makeShop();
    const adm = await makeUser('adm');
    await admin(`insert into public.platform_admins(user_id) values ($1)`, [adm]);
    expect(await rpcError(s.owner, 'admin_update_shop', { p_shop_id: s.shop, p_name_mr: 'x', p_name_en: 'x', p_status: 'suspended' })).toBe('ADMIN_ONLY');
    await rpc(adm, 'admin_update_shop', { p_shop_id: s.shop, p_name_mr: 'चाचणी दुकान', p_name_en: 'Test Shop', p_status: 'suspended' });
    expect(await rpcError(s.owner, 'list_customers', { p_shop_id: s.shop })).toBe('FORBIDDEN');
    expect(await rpcError(s.cashier, 'create_invoice', { p_shop_id: s.shop, p_idempotency_key: key(), p_customer_id: null, p_items: [item('1', 'piece', 100)], p_paid_paise: 100 })).toBe('FORBIDDEN');
    await rpc(adm, 'admin_update_shop', { p_shop_id: s.shop, p_name_mr: 'चाचणी दुकान', p_name_en: 'Test Shop', p_status: 'active' });
    expect(await rpc(s.owner, 'list_customers', { p_shop_id: s.shop })).toEqual([]);
  });

  it('the admin can add and update shops and people but cannot see or touch any shop money', async () => {
    const adm = await makeUser('adm');
    await admin(`insert into public.platform_admins(user_id) values ($1)`, [adm]);
    const ctx = await rpc(adm, 'my_context');
    expect(ctx.is_platform_admin).toBe(true);
    expect(ctx.shops).toEqual([]);                                   // not a member of any shop
    const shops = await rpc(adm, 'admin_list_shops');
    const listedA = shops.find((x: any) => x.id === a.shop);
    expect(listedA.members.map((m: any) => m.role).sort()).toEqual(['cashier', 'owner']);
    expect(JSON.stringify(shops)).not.toMatch(/paise|balance/);       // no money in the admin view
    for (const [fn, args] of [
      ['list_customers', { p_shop_id: a.shop }], ['get_customer', { p_shop_id: a.shop, p_customer_id: custA }],
      ['get_shop_daily_summary', { p_shop_id: a.shop }], ['list_members', { p_shop_id: a.shop }],
      ['receive_payment', { p_shop_id: a.shop, p_idempotency_key: key(), p_customer_id: custA, p_amount_paise: 100 }],
      ['reverse_invoice', { p_shop_id: b.shop, p_idempotency_key: key(), p_invoice_id: invB, p_reason: 'admin test' }],
    ] as const) {
      expect(await rpcError(adm, fn, args), fn).toBe('FORBIDDEN');
    }
    expect(await rpcError(adm, 'create_invoice', { p_shop_id: a.shop, p_idempotency_key: key(), p_customer_id: null, p_items: [item('1', 'piece', 100)], p_paid_paise: 100 })).toBe('FORBIDDEN');
    await withUser(adm, async (c) => {
      for (const t of ['customers', 'invoices', 'payments', 'ledger_entries']) {
        expect((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, t).toBe(0);
      }
    });
    expect(await rpcError(adm, 'admin_set_shop_status', { p_shop_id: a.shop, p_status: 'suspended' })).toMatch(/permission denied/);
    expect(await rpcError(adm, 'admin_list_audit')).toMatch(/permission denied/);
    expect(await rpcError(a.owner, 'admin_list_shops')).toBe('ADMIN_ONLY');
    expect(await rpcError(a.owner, 'admin_update_member', { p_shop_id: a.shop, p_user_id: a.cashier, p_display_name: 'x', p_role: 'owner', p_status: 'active' })).toBe('ADMIN_ONLY');
    await rpc(adm, 'admin_update_member', { p_shop_id: a.shop, p_user_id: a.owner, p_display_name: 'नवीन नाव', p_role: 'owner', p_status: 'active' });
    expect((await rpc(adm, 'admin_list_shops')).find((x: any) => x.id === a.shop).members.find((m: any) => m.user_id === a.owner).display_name).toBe('नवीन नाव');
  });

  it('cashier limits: no products, no customer edits, no staff, no audit, no past-day reports', async () => {
    expect(await rpcError(a.cashier, 'save_product', { p_shop_id: a.shop, p_product: { name: 'x', unit: 'kg', default_price_paise: 1 } })).toBe('OWNER_ONLY');
    expect(await rpcError(a.cashier, 'save_customer', { p_shop_id: a.shop, p_customer: { id: custA, name: 'x' } })).toBe('OWNER_ONLY');
    expect(await rpcError(a.cashier, 'list_members', { p_shop_id: a.shop })).toBe('OWNER_ONLY');
    expect(await rpcError(a.cashier, 'set_member', { p_shop_id: a.shop, p_user_id: a.cashier, p_role: 'owner', p_status: 'active' })).toBe('OWNER_ONLY');
    expect(await rpcError(a.cashier, 'list_audit', { p_shop_id: a.shop })).toBe('OWNER_ONLY');
    expect(await rpcError(a.cashier, 'get_report', { p_shop_id: a.shop, p_from: '2026-01-01', p_to: '2026-01-31' })).toBe('OWNER_ONLY');
    expect(await rpcError(a.cashier, 'get_shop_daily_summary', { p_shop_id: a.shop, p_date: '2020-01-01' })).toBe('OWNER_ONLY');
    expect(await rpcError(a.cashier, 'update_shop', { p_shop_id: a.shop, p_name_mr: 'x', p_name_en: 'x' })).toBe('OWNER_ONLY');
    expect((await rpc(a.cashier, 'save_customer', { p_shop_id: a.shop, p_customer: { name: 'नवीन' } })).created).toBe(true);
    await withUser(a.cashier, async (c) => {
      expect((await c.query(`select count(*)::int n from public.audit_events`)).rows[0].n).toBe(0);
      expect((await c.query(`select count(*)::int n from public.shop_members`)).rows[0].n).toBe(1);
    });
  });

  it('owners cannot change owners, and the last owner cannot be removed', async () => {
    const s = await makeShop();
    const adm = await makeUser('adm');
    await admin(`insert into public.platform_admins(user_id) values ($1)`, [adm]);
    expect(await rpcError(s.owner, 'set_member', { p_shop_id: s.shop, p_user_id: s.cashier, p_role: 'owner', p_status: 'active' })).toBe('ADMIN_ONLY');
    expect(await rpcError(s.owner, 'set_member', { p_shop_id: s.shop, p_user_id: s.owner, p_role: 'owner', p_status: 'disabled' })).toBe('ADMIN_ONLY');
    const upd = (user: string, role: string, status: string) => ({ p_shop_id: s.shop, p_user_id: user, p_display_name: 'नाव', p_role: role, p_status: status });
    expect(await rpcError(adm, 'admin_update_member', upd(s.owner, 'cashier', 'active'))).toBe('LAST_OWNER');
    expect(await rpcError(adm, 'admin_update_member', upd(s.owner, 'owner', 'disabled'))).toBe('LAST_OWNER');
    await rpc(adm, 'admin_update_member', upd(s.cashier, 'owner', 'active'));
    await rpc(adm, 'admin_update_member', upd(s.owner, 'owner', 'disabled'));
    expect(await rpcError(s.owner, 'list_customers', { p_shop_id: s.shop })).toBe('FORBIDDEN');
    const n = await admin(`select count(*)::int n from public.audit_events where shop_id = $1 and action = 'member.updated'`, [s.shop]);
    expect(n.rows[0].n).toBe(2);
  });
});

describe('onboarding and service functions', () => {
  const svc = <T = any>(fn: string, args: Record<string, unknown>) => rpc<T>(null, fn, args, 'service_role');
  const svcErr = (fn: string, args: Record<string, unknown>) => rpcError(null, fn, args, 'service_role');

  it('first-run setup needs the one-time code, works once, and seeds the shop for that owner only', async () => {
    await admin(`delete from public.platform_admins`);
    await admin(`insert into public.platform_setup(id, code_hash, expires_at) values (1, encode(sha256('correct-code'::bytea), 'hex'), now() + interval '1 hour')
                 on conflict (id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, used_at = null`);
    const uid = randomUUID();
    await admin(`insert into auth.users(id, email) values ($1, $2)`, [uid, `${uid}@login.test`]);
    expect(await svcErr('svc_check_setup', { p_code: 'wrong', p_username: 'gaurav' })).toBe('INVALID_SETUP_CODE');
    expect(await svcErr('svc_complete_setup', { p_code: 'wrong', p_user_id: uid, p_username: 'gaurav', p_display_name: 'G' })).toBe('INVALID_SETUP_CODE');
    const name = `adm${uid.slice(0, 6)}`;
    const r = await svc('svc_complete_setup', { p_code: 'correct-code', p_user_id: uid, p_username: name, p_display_name: 'Gaurav' });
    const shop = (await admin(`select * from public.shops where id = $1`, [r.shop_id])).rows[0];
    expect(shop).toMatchObject({ name_en: 'Super Kirana, Niphad', name_mr: 'सुपर किराणा, निफाड', default_locale: 'mr-IN', secondary_locale: 'en-IN', currency: 'INR', timezone: 'Asia/Kolkata' });
    const members = (await admin(`select user_id, role from public.shop_members where shop_id = $1`, [r.shop_id])).rows;
    expect(members).toEqual([{ user_id: uid, role: 'owner' }]);
    expect(await svcErr('svc_check_setup', { p_code: 'correct-code', p_username: 'someoneelse' })).toBe('SETUP_DONE');
    expect((await admin(`select count(*)::int n from public.shops where shop_username = 'superkirana-niphad'`)).rows[0].n).toBe(1);
    // Nobody else can see the seeded shop.
    await withUser(a.owner, async (c) => {
      expect((await c.query(`select count(*)::int n from public.shops where id = $1`, [r.shop_id])).rows[0].n).toBe(0);
    });
  });

  it('creating a shop is admin-only and a repeated request never creates a duplicate', async () => {
    const adm = await makeUser('adm');
    await admin(`insert into public.platform_admins(user_id) values ($1)`, [adm]);
    const req = randomUUID();
    const su = `shop-${req.slice(0, 8)}`;
    const ownerName = `own${req.slice(0, 8)}`;
    const base = { p_request_id: req, p_shop_username: su, p_name_mr: 'नवीन दुकान', p_name_en: 'New Shop', p_owner_username: ownerName, p_owner_is_new: true };
    expect(await svcErr('svc_precheck_create_shop', { p_actor: a.owner, ...base })).toBe('ADMIN_ONLY');
    expect(await svcErr('svc_precheck_create_shop', { p_actor: adm, ...base, p_shop_username: 'Bad Name!' })).toBe('INVALID_SHOP_USERNAME');
    expect((await svc('svc_precheck_create_shop', { p_actor: adm, ...base })).existing_shop_id).toBeNull();
    const ownerId = randomUUID();
    await admin(`insert into auth.users(id, email) values ($1, $2)`, [ownerId, `${ownerId}@login.test`]);
    const created = await svc('svc_create_shop', { p_actor: adm, p_request_id: req, p_shop_username: su, p_name_mr: 'नवीन दुकान', p_name_en: 'New Shop', p_owner_user_id: ownerId, p_owner_username: ownerName, p_owner_display_name: 'मालक', p_owner_is_new: true });
    expect((await svc('svc_precheck_create_shop', { p_actor: adm, ...base })).existing_shop_id).toBe(created.shop_id);
    expect(await svcErr('svc_precheck_create_shop', { p_actor: adm, ...base, p_request_id: randomUUID() })).toBe('SHOP_USERNAME_TAKEN');
    expect((await admin(`select count(*)::int n from public.shops where shop_username = $1`, [su])).rows[0].n).toBe(1);
    // New owners must set their own password before they can do anything.
    expect((await rpc(ownerId, 'my_context')).must_change_password).toBe(true);
    await svc('svc_password_changed', { p_user_id: ownerId });
    const ctx = await rpc(ownerId, 'my_context');
    expect(ctx.shops).toHaveLength(1);
    expect(ctx.shops[0]).toMatchObject({ id: created.shop_id, role: 'owner' });
  });

  it('owners can add cashiers to their own shop only; password resets are scoped', async () => {
    const s = await makeShop();
    const other = await makeShop();
    const uname = `c${randomUUID().slice(0, 8)}`;
    expect(await svcErr('svc_precheck_add_member', { p_actor: s.owner, p_shop_id: other.shop, p_username: uname, p_role: 'cashier', p_is_new: true })).toBe('FORBIDDEN');
    expect(await svcErr('svc_precheck_add_member', { p_actor: s.cashier, p_shop_id: s.shop, p_username: uname, p_role: 'cashier', p_is_new: true })).toBe('FORBIDDEN');
    expect(await svcErr('svc_precheck_add_member', { p_actor: s.owner, p_shop_id: s.shop, p_username: uname, p_role: 'owner', p_is_new: true })).toBe('ADMIN_ONLY');
    const uid = randomUUID();
    await admin(`insert into auth.users(id, email) values ($1, $2)`, [uid, `${uid}@login.test`]);
    await svc('svc_add_member', { p_actor: s.owner, p_shop_id: s.shop, p_user_id: uid, p_username: uname, p_display_name: 'रोखपाल', p_role: 'cashier', p_is_new: true });
    expect(await svcErr('svc_precheck_add_member', { p_actor: s.owner, p_shop_id: s.shop, p_username: uname, p_role: 'cashier', p_is_new: true })).toBe('USERNAME_TAKEN');
    await svc('svc_password_changed', { p_user_id: uid });
    await svc('svc_begin_password_reset', { p_actor: s.owner, p_shop_id: s.shop, p_user_id: uid });
    expect((await rpc(uid, 'my_context')).must_change_password).toBe(true);
    expect(await svcErr('svc_begin_password_reset', { p_actor: s.owner, p_shop_id: s.shop, p_user_id: other.cashier })).toBe('FORBIDDEN');
    expect(await svcErr('svc_begin_password_reset', { p_actor: s.owner, p_shop_id: s.shop, p_user_id: s.owner })).toBe('FORBIDDEN');
    expect(await svcErr('svc_begin_password_reset', { p_actor: s.cashier, p_shop_id: s.shop, p_user_id: uid })).toBe('FORBIDDEN');
  });

  it('the login rate limiter blocks after the allowed attempts in a window', async () => {
    const k = `login:${randomUUID()}`;
    const out: boolean[] = [];
    for (let i = 0; i < 7; i++) out.push(await svc('svc_rate_limit', { p_key: k, p_max: 5, p_window_seconds: 900 }));
    expect(out).toEqual([true, true, true, true, true, false, false]);
    await admin(`update public.auth_throttle set window_start = now() - interval '16 minutes' where key = $1`, [k]);
    expect(await svc('svc_rate_limit', { p_key: k, p_max: 5, p_window_seconds: 900 })).toBe(true);
  });
});
