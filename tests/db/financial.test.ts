// Financial correctness tests (spec section 18, cases A–K, Q–T) against a real Postgres with the
// production migrations applied. Every call goes through the same RPC functions the app uses,
// as a non-superuser role with a simulated JWT.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lineGrossPaise, type Unit } from '../../src/lib/money';
import { admin, balance, bill, item, key, makeCustomer, makeShop, pool, reconciled, rpc, rpcError, type Fixture } from './helpers';

let f: Fixture;
beforeAll(async () => { f = await makeShop(); });
afterAll(async () => { await pool.end(); });

const R = (rupees: number) => rupees * 100;

describe('billing and dues', () => {
  it('A: ₹315 bill with ₹200 paid leaves ₹115 new outstanding', async () => {
    const c = await makeCustomer(f);
    const r = await bill(f, f.cashier, c, R(315), R(200));
    expect(r.total_paise).toBe(R(315));
    expect(r.bill_due_paise).toBe(R(115));
    expect(r.new_balance_paise).toBe(R(115));
    expect(await balance(f, c)).toBe(R(115));
    expect(await reconciled(f, c)).toBe(true);
  });

  it('B: ₹500 previous + ₹315 bill − ₹200 paid = ₹615 total outstanding', async () => {
    const c = await makeCustomer(f, 'जुनी उधारी', R(500));
    const r = await bill(f, f.cashier, c, R(315), R(200));
    expect(r.previous_balance_paise).toBe(R(500));
    expect(r.new_balance_paise).toBe(R(615));
    expect(await balance(f, c)).toBe(R(615));
    const inv = await rpc(f.cashier, 'get_invoice', { p_shop_id: f.shop, p_invoice_id: r.invoice_id });
    expect(inv.previous_balance_paise).toBe(R(500));
    expect(inv.balance_after_paise).toBe(R(615));
    expect(inv.outstanding_paise).toBe(R(115));
    expect(await reconciled(f, c)).toBe(true);
  });

  it('C: full payment leaves nothing due on that bill', async () => {
    const c = await makeCustomer(f);
    const r = await bill(f, f.cashier, c, R(315), R(315));
    expect(r.bill_due_paise).toBe(0);
    expect(await balance(f, c)).toBe(0);
  });

  it('D: zero-payment credit bill adds the full amount to dues', async () => {
    const c = await makeCustomer(f);
    const r = await bill(f, f.cashier, c, R(315), 0);
    expect(r.payment_ids).toEqual([]);
    expect(await balance(f, c)).toBe(R(315));
  });

  it('E: collecting ₹400 of an old ₹700 debt leaves ₹300 and adds no sales', async () => {
    const g = await makeShop();
    const c = await makeCustomer(g, 'उधार', R(700));
    const before = await rpc(g.owner, 'get_shop_daily_summary', { p_shop_id: g.shop });
    const r = await rpc(g.cashier, 'receive_payment', { p_shop_id: g.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(400), p_method: 'upi' });
    expect(r.new_balance_paise).toBe(R(300));
    const after = await rpc(g.owner, 'get_shop_daily_summary', { p_shop_id: g.shop });
    expect(after.sales_gross_paise).toBe(before.sales_gross_paise);
    expect(after.net_sales_paise).toBe(0);
    expect(after.net_collections_paise).toBe(R(400));
    expect(after.upi_paise).toBe(R(400));
    expect(after.total_outstanding_paise).toBe(R(300));
    expect((await admin(`select count(*)::int n from public.invoices where shop_id = $1`, [g.shop])).rows[0].n).toBe(0);
  });

  it('money above the bill total goes to old dues as a collection, not sales', async () => {
    const g = await makeShop();
    const c = await makeCustomer(g, 'x', R(500));
    const r = await bill(g, g.cashier, c, R(315), R(500));
    expect(r.bill_paid_paise).toBe(R(315));
    expect(r.old_dues_paid_paise).toBe(R(185));
    expect(r.new_balance_paise).toBe(R(315));
    const s = await rpc(g.owner, 'get_shop_daily_summary', { p_shop_id: g.shop });
    expect(s.sales_gross_paise).toBe(R(315));
    expect(s.net_collections_paise).toBe(R(500));
    expect(await reconciled(g, c)).toBe(true);
  });

  it('walk-in bills must be settled in full; no anonymous credit', async () => {
    expect(await rpcError(f.cashier, 'create_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: null, p_items: [item('1', 'piece', R(100))], p_paid_paise: R(60) })).toBe('WALKIN_MUST_SETTLE');
    const r = await bill(f, f.cashier, null, R(100), R(100));
    expect(r.new_balance_paise).toBe(0);
  });

  it('overpayments are rejected at billing and at collection', async () => {
    const c = await makeCustomer(f);
    expect(await rpcError(f.cashier, 'create_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_items: [item('1', 'piece', R(100))], p_paid_paise: R(150) })).toBe('OVERPAYMENT');
    await bill(f, f.cashier, c, R(100), 0);
    expect(await rpcError(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(101) })).toBe('OVERPAYMENT');
    expect(await balance(f, c)).toBe(R(100));
  });

  it('collections are applied to the opening balance first, then the oldest bill, and are visible', async () => {
    const c = await makeCustomer(f, 'fifo', R(100));
    const b1 = await bill(f, f.cashier, c, R(200), 0);
    const b2 = await bill(f, f.cashier, c, R(300), 0);
    const p = await rpc(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(350) });
    const pay = await rpc(f.cashier, 'get_payment', { p_shop_id: f.shop, p_payment_id: p.payment_id });
    expect(pay.allocations).toEqual([
      { target: 'opening', invoice_no: null, amount_paise: R(100) },
      { target: 'invoice', invoice_no: b1.invoice_no, amount_paise: R(200) },
      { target: 'invoice', invoice_no: b2.invoice_no, amount_paise: R(50) },
    ]);
    const cust = await rpc(f.cashier, 'get_customer', { p_shop_id: f.shop, p_customer_id: c });
    expect(cust.unpaid_invoices).toHaveLength(1);
    expect(cust.unpaid_invoices[0].outstanding_paise).toBe(R(250));
    expect(cust.reconciled).toBe(true);
  });
});

describe('idempotency and retries', () => {
  it('F: the same idempotency key creates one invoice only', async () => {
    const c = await makeCustomer(f);
    const k = key();
    const a = await bill(f, f.cashier, c, R(315), R(200), k);
    const b = await bill(f, f.cashier, c, R(315), R(200), k);
    expect(b.invoice_id).toBe(a.invoice_id);
    expect(b.replayed).toBe(true);
    expect((await admin(`select count(*)::int n from public.invoices where customer_id = $1`, [c])).rows[0].n).toBe(1);
    expect(await balance(f, c)).toBe(R(115));
  });

  it('F: five simultaneous submissions of one key still create one invoice', async () => {
    const c = await makeCustomer(f);
    const k = key();
    const rs = await Promise.all(Array.from({ length: 5 }, () => bill(f, f.cashier, c, R(100), 0, k)));
    expect(new Set(rs.map((r) => r.invoice_id)).size).toBe(1);
    expect(rs.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balance(f, c)).toBe(R(100));
  });

  it('a key cannot be reused for a different request', async () => {
    const c = await makeCustomer(f);
    const k = key();
    await bill(f, f.cashier, c, R(100), 0, k);
    expect(await rpcError(f.cashier, 'create_invoice', { p_shop_id: f.shop, p_idempotency_key: k, p_customer_id: c, p_items: [item('1', 'piece', R(999))], p_paid_paise: 0 })).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('R: a payment can be retried safely after a lost response, and its status can be looked up', async () => {
    const c = await makeCustomer(f, 'retry', R(700));
    const k = key();
    const args = { p_shop_id: f.shop, p_idempotency_key: k, p_customer_id: c, p_amount_paise: R(400) };
    expect((await rpc(f.cashier, 'get_mutation_status', { p_shop_id: f.shop, p_idempotency_key: k })).found).toBe(false);
    const first = await rpc(f.cashier, 'receive_payment', args);
    const status = await rpc(f.cashier, 'get_mutation_status', { p_shop_id: f.shop, p_idempotency_key: k });
    expect(status.found).toBe(true);
    expect(status.result.payment_id).toBe(first.payment_id);
    const retry = await rpc(f.cashier, 'receive_payment', args);
    expect(retry.payment_id).toBe(first.payment_id);
    expect(await balance(f, c)).toBe(R(300));
    expect((await admin(`select count(*)::int n from public.payments where customer_id = $1`, [c])).rows[0].n).toBe(1);
  });

  it('a failed posting leaves nothing behind and the key can be used again', async () => {
    const c = await makeCustomer(f);
    const k = key();
    expect(await rpcError(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: k, p_customer_id: c, p_amount_paise: R(10) })).toBe('OVERPAYMENT');
    expect((await rpc(f.cashier, 'get_mutation_status', { p_shop_id: f.shop, p_idempotency_key: k })).found).toBe(false);
  });
});

describe('concurrency', () => {
  it('G: two concurrent payments cannot over-collect', async () => {
    const c = await makeCustomer(f, 'conc', R(700));
    const pay = () => rpc(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(400) })
      .then(() => 'ok', (e) => String(e.message));
    const out = await Promise.all([pay(), pay()]);
    expect(out.sort()).toEqual(['OVERPAYMENT', 'ok']);
    expect(await balance(f, c)).toBe(R(300));
    expect(await reconciled(f, c)).toBe(true);
  });

  it('G: twelve concurrent payments and bills keep allocations and balance exact', async () => {
    const c = await makeCustomer(f, 'busy', R(1000));
    const jobs = [
      ...Array.from({ length: 8 }, () => rpc(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(50) })),
      ...Array.from({ length: 4 }, () => bill(f, f.cashier, c, R(125), R(25))),
    ];
    await Promise.all(jobs);
    expect(await balance(f, c)).toBe(R(1000 - 400 + 400));
    expect(await reconciled(f, c)).toBe(true);
    const over = await admin(
      `select count(*)::int n from public.invoices i where i.customer_id = $1
         and (select coalesce(sum(a.amount_paise),0) from public.payment_allocations a where a.invoice_id = i.id) > i.total_paise`, [c]);
    expect(over.rows[0].n).toBe(0);
  });

  it('invoice numbers are unique and never reused under concurrent billing', async () => {
    const g = await makeShop();
    const rs = await Promise.all(Array.from({ length: 15 }, () => bill(g, g.cashier, null, R(10), R(10))));
    const nos = rs.map((r) => r.invoice_no).sort((a, b) => a - b);
    expect(new Set(nos).size).toBe(15);
    expect(nos).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
});

describe('reversals and credits', () => {
  it('H: reversing an invoice updates the ledger exactly once', async () => {
    const c = await makeCustomer(f);
    const b = await bill(f, f.cashier, c, R(315), 0);
    const k = key();
    const r1 = await rpc(f.owner, 'reverse_invoice', { p_shop_id: f.shop, p_idempotency_key: k, p_invoice_id: b.invoice_id, p_reason: 'चुकीचे बिल' });
    const r2 = await rpc(f.owner, 'reverse_invoice', { p_shop_id: f.shop, p_idempotency_key: k, p_invoice_id: b.invoice_id, p_reason: 'चुकीचे बिल' });
    expect(r1.reversed).toBe(true);
    expect(r2.replayed).toBe(true);
    expect(await rpcError(f.owner, 'reverse_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_invoice_id: b.invoice_id, p_reason: 'again' })).toBe('ALREADY_REVERSED');
    const n = await admin(`select count(*)::int n from public.ledger_entries where invoice_id = $1 and entry_type = 'invoice_reversal'`, [b.invoice_id]);
    expect(n.rows[0].n).toBe(1);
    expect(await balance(f, c)).toBe(0);
    expect(await reconciled(f, c)).toBe(true);
  });

  it('H: reversing a part-paid bill also reverses the money taken with it', async () => {
    const c = await makeCustomer(f, 'part', R(500));
    const b = await bill(f, f.cashier, c, R(315), R(200));
    const r = await rpc(f.owner, 'reverse_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_invoice_id: b.invoice_id, p_reason: 'cancelled' });
    expect(r.refunded_paise).toBe(R(200));
    expect(await balance(f, c)).toBe(R(500));
    expect(await reconciled(f, c)).toBe(true);
  });

  it('reversing a walk-in bill nets its ledger to zero', async () => {
    const g = await makeShop();
    const b = await bill(g, g.cashier, null, R(90), R(90));
    await rpc(g.owner, 'reverse_invoice', { p_shop_id: g.shop, p_idempotency_key: key(), p_invoice_id: b.invoice_id, p_reason: 'mistake' });
    const rec = await rpc(g.owner, 'reconcile_shop', { p_shop_id: g.shop });
    expect(rec.ok).toBe(true);
    const s = await rpc(g.owner, 'get_shop_daily_summary', { p_shop_id: g.shop });
    expect(s.net_sales_paise).toBe(0);
    expect(s.net_collections_paise).toBe(0);
  });

  it('a later collection applied to a reversed bill moves to other dues, or blocks the reversal', async () => {
    const c = await makeCustomer(f);
    const b1 = await bill(f, f.cashier, c, R(200), 0);
    const b2 = await bill(f, f.cashier, c, R(300), 0);
    await rpc(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(200) });
    await rpc(f.owner, 'reverse_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_invoice_id: b1.invoice_id, p_reason: 'returned all' });
    expect(await balance(f, c)).toBe(R(100));
    const inv2 = await rpc(f.owner, 'get_invoice', { p_shop_id: f.shop, p_invoice_id: b2.invoice_id });
    expect(inv2.outstanding_paise).toBe(R(100));
    expect(await reconciled(f, c)).toBe(true);

    const d = await makeCustomer(f);
    const only = await bill(f, f.cashier, d, R(200), 0);
    await rpc(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: d, p_amount_paise: R(150) });
    expect(await rpcError(f.owner, 'reverse_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_invoice_id: only.invoice_id, p_reason: 'cancel' })).toBe('PAYMENT_EXCEEDS_DUES');
    expect(await balance(f, d)).toBe(R(50));
    expect(await reconciled(f, d)).toBe(true);
  });

  it('I: reversing a payment restores the outstanding amount', async () => {
    const c = await makeCustomer(f, 'rev', R(700));
    const p = await rpc(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(400) });
    expect(await balance(f, c)).toBe(R(300));
    const r = await rpc(f.owner, 'reverse_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_payment_id: p.payment_id, p_reason: 'चुकीची नोंद' });
    expect(r.new_balance_paise).toBe(R(700));
    expect(await balance(f, c)).toBe(R(700));
    expect(await rpcError(f.owner, 'reverse_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_payment_id: p.payment_id, p_reason: 'twice' })).toBe('ALREADY_REVERSED');
    expect(await reconciled(f, c)).toBe(true);
  });

  it('J: a return/credit reduces the balance, and cannot exceed the dues or the bill', async () => {
    const c = await makeCustomer(f);
    const b = await bill(f, f.cashier, c, R(315), R(100));
    const cr = await rpc(f.owner, 'issue_credit_or_return', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(65), p_reason: 'साखर परत', p_kind: 'return', p_invoice_id: b.invoice_id });
    expect(cr.new_balance_paise).toBe(R(150));
    expect(await balance(f, c)).toBe(R(150));
    expect(await rpcError(f.owner, 'issue_credit_or_return', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(151), p_reason: 'too much' })).toBe('CREDIT_EXCEEDS_DUES');
    expect(await rpcError(f.owner, 'reverse_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_invoice_id: b.invoice_id, p_reason: 'cancel' })).toBe('INVOICE_HAS_CREDITS');
    await rpc(f.owner, 'reverse_credit', { p_shop_id: f.shop, p_idempotency_key: key(), p_credit_note_id: cr.credit_note_id, p_reason: 'entered by mistake' });
    expect(await balance(f, c)).toBe(R(215));
    expect(await reconciled(f, c)).toBe(true);
  });

  it('cashiers cannot reverse bills or payments or issue credits', async () => {
    const c = await makeCustomer(f);
    const b = await bill(f, f.cashier, c, R(100), R(40));
    expect(await rpcError(f.cashier, 'reverse_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_invoice_id: b.invoice_id, p_reason: 'nope' })).toBe('OWNER_ONLY');
    expect(await rpcError(f.cashier, 'reverse_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_payment_id: b.payment_ids[0], p_reason: 'nope' })).toBe('OWNER_ONLY');
    expect(await rpcError(f.cashier, 'issue_credit_or_return', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: 100, p_reason: 'nope' })).toBe('OWNER_ONLY');
  });

  it('opening balance: owner only, audited, and cannot drop below what was already paid', async () => {
    const c = await makeCustomer(f);
    expect(await rpcError(f.cashier, 'set_opening_balance', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(500) })).toBe('OWNER_ONLY');
    expect(await rpcError(f.cashier, 'save_customer', { p_shop_id: f.shop, p_customer: { name: 'x', opening_balance_paise: 100 } })).toBe('OWNER_ONLY');
    await rpc(f.owner, 'set_opening_balance', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(500) });
    await rpc(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(300) });
    expect(await rpcError(f.owner, 'set_opening_balance', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(100) })).toBe('OPENING_ALREADY_PAID');
    await rpc(f.owner, 'set_opening_balance', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: R(450) });
    expect(await balance(f, c)).toBe(R(150));
    expect(await reconciled(f, c)).toBe(true);
    const a = await admin(`select count(*)::int n from public.audit_events where action = 'customer.opening_balance' and entity_id = $1`, [c]);
    expect(a.rows[0].n).toBe(2);
  });
});

describe('snapshots, validation, rounding', () => {
  it('K: changing a product price or name does not change earlier invoices', async () => {
    const p = await rpc(f.owner, 'save_product', { p_shop_id: f.shop, p_product: { name: 'साखर', unit: 'kg', default_price_paise: 4200 } });
    const c = await makeCustomer(f);
    const b = await rpc(f.cashier, 'create_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_items: [{ product_id: p.id, qty: '2', unit: 'kg', unit_price_paise: 4200 }], p_paid_paise: 0 });
    await rpc(f.owner, 'save_product', { p_shop_id: f.shop, p_product: { id: p.id, name: 'Sugar premium', unit: 'kg', default_price_paise: 9900 } });
    await rpc(f.owner, 'save_customer', { p_shop_id: f.shop, p_customer: { id: c, name: 'नवीन नाव' } });
    const inv = await rpc(f.cashier, 'get_invoice', { p_shop_id: f.shop, p_invoice_id: b.invoice_id });
    expect(inv.items[0]).toMatchObject({ name: 'साखर', unit_price_paise: 4200, line_total_paise: 8400 });
    expect(inv.total_paise).toBe(8400);
    expect(inv.customer_name).toBe('ग्राहक');
  });

  it('totals are computed on the server; a client "total" field is ignored', async () => {
    const r = await rpc(f.cashier, 'create_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: null,
      p_items: [{ name: 'x', qty: '2', unit: 'piece', unit_price_paise: 500, line_total_paise: 1, total: 1 }], p_paid_paise: 1000 });
    expect(r.total_paise).toBe(1000);
  });

  it('Q: negative, malformed, over-precise and out-of-range values are rejected', async () => {
    const base = { p_shop_id: f.shop, p_customer_id: null as string | null, p_paid_paise: 0 };
    const tryItems = (items: unknown, paid: unknown = 0) => rpcError(f.cashier, 'create_invoice', { ...base, p_idempotency_key: key(), p_items: items, p_paid_paise: paid });
    expect(await tryItems([item('1', 'piece', -100)])).toBe('INVALID_AMOUNT');
    expect(await tryItems([item('1', 'piece', 100.5)])).toBe('INVALID_AMOUNT');
    expect(await tryItems([{ name: 'x', qty: '1', unit: 'piece', unit_price_paise: '100' }])).toBe('INVALID_AMOUNT');
    expect(await tryItems([item('1', 'piece', 1_000_000_001)])).toBe('PRICE_REQUIRED');
    expect(await tryItems([{ name: 'x', qty: '1', unit: 'piece' }])).toBe('PRICE_REQUIRED');
    expect(await tryItems([item('-1', 'piece', 100)])).toBe('INVALID_QUANTITY');
    expect(await tryItems([item('0', 'piece', 100)])).toBe('INVALID_QUANTITY');
    expect(await tryItems([item('1.2345', 'kg', 100)])).toBe('INVALID_QUANTITY');
    expect(await tryItems([item('abc', 'kg', 100)])).toBe('INVALID_QUANTITY');
    expect(await tryItems([item('1e3', 'kg', 100)])).toBe('INVALID_QUANTITY');
    expect(await tryItems([item('1', 'bag', 100)])).toBe('INVALID_UNIT');
    expect(await tryItems([item('500', 'g', 4200, { price_unit: 'litre' })])).toBe('UNIT_MISMATCH');
    expect(await tryItems([item('1', 'piece', 100, { discount_paise: 101 })])).toBe('DISCOUNT_TOO_LARGE');
    expect(await tryItems([])).toBe('EMPTY_BILL');
    expect(await tryItems([item('1', 'piece', 100)], -5)).toBe('INVALID_AMOUNT');
    expect(await tryItems([item('1', 'piece', 100)], 100.25)).toMatch(/bigint|INVALID/);
    const c = await makeCustomer(f, 'q', R(10));
    for (const bad of [0, -100, 100_000_000_001]) {
      expect(await rpcError(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: bad })).toBe('INVALID_AMOUNT');
    }
    expect(await rpcError(f.cashier, 'receive_payment', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: c, p_amount_paise: 100, p_method: 'cheque' })).toBe('INVALID_METHOD');
  });

  it('S: unit conversion and rounding are deterministic and match the client preview', async () => {
    const cases: [string, Unit, Unit, number, number][] = [
      ['500', 'g', 'kg', 4200, 2100],     // 500 g at ₹42/kg
      ['0.5', 'kg', 'kg', 4200, 2100],
      ['250', 'ml', 'litre', 11150, 2788], // 2787.5 → half-up
      ['1', 'piece', 'dozen', 7000, 583],  // 583.33
      ['5', 'piece', 'dozen', 7000, 2917], // 2916.67
      ['0.333', 'kg', 'kg', 9999, 3330],   // 3329.667
      ['1.5', 'dozen', 'piece', 550, 9900],
      ['0.001', 'kg', 'kg', 499, 0],       // 0.499 → 0
      ['0.001', 'kg', 'kg', 500, 1],       // 0.5 → 1
      ['750', 'g', 'kg', 3333, 2500],      // 2499.75
    ];
    for (const [qty, unit, pu, price, expected] of cases) {
      const sql = await admin(`select app_private.line_gross($1::numeric, $2, $3, $4) as g`, [qty, unit, pu, price]);
      expect(Number(sql.rows[0].g), `${qty} ${unit} @ ${price}/${pu}`).toBe(expected);
      expect(lineGrossPaise(Math.round(Number(qty) * 1000), unit, pu, price)).toBe(expected);
    }
    const a = await rpc(f.cashier, 'create_invoice', { p_shop_id: f.shop, p_idempotency_key: key(), p_customer_id: null,
      p_items: [item('500', 'g', 4200, { price_unit: 'kg' }), item('250', 'ml', 11150, { price_unit: 'litre' }), item('5', 'piece', 7000, { price_unit: 'dozen', discount_paise: 17 })],
      p_paid_paise: 2100 + 2788 + 2917 - 17 });
    expect(a.total_paise).toBe(7788);
  });

  it('posted records cannot be edited or deleted, even by the table owner', async () => {
    const c = await makeCustomer(f);
    const b = await bill(f, f.cashier, c, R(100), R(40));
    const tries = [
      `update public.invoices set total_paise = 1, subtotal_paise = 1 where id = '${b.invoice_id}'`,
      `delete from public.invoices where id = '${b.invoice_id}'`,
      `update public.invoice_items set unit_price_paise = 1 where invoice_id = '${b.invoice_id}'`,
      `update public.ledger_entries set amount_paise = 1 where invoice_id = '${b.invoice_id}'`,
      `delete from public.ledger_entries where invoice_id = '${b.invoice_id}'`,
      `update public.payments set amount_paise = 1 where id = '${b.payment_ids[0]}'`,
      `delete from public.payment_allocations where invoice_id = '${b.invoice_id}'`,
      `delete from public.audit_events where entity_id = '${b.invoice_id}'`,
    ];
    for (const sql of tries) {
      await expect(admin(sql), sql).rejects.toThrow('IMMUTABLE_RECORD');
    }
    await expect(admin(`update public.customer_balances set balance_paise = -5 where customer_id = $1`, [c])).rejects.toThrow('NEGATIVE_BALANCE');
  });

  it('T: dashboard totals reconcile to posted records', async () => {
    const g = await makeShop();
    const c1 = await makeCustomer(g, 'a', R(250));
    const c2 = await makeCustomer(g, 'b');
    const b1 = await bill(g, g.cashier, c1, R(315), R(200));
    await bill(g, g.cashier, c2, R(1200), 0);
    await bill(g, g.cashier, null, R(80), R(80));
    const p = await rpc(g.cashier, 'receive_payment', { p_shop_id: g.shop, p_idempotency_key: key(), p_customer_id: c2, p_amount_paise: R(500), p_method: 'upi' });
    await rpc(g.owner, 'reverse_payment', { p_shop_id: g.shop, p_idempotency_key: key(), p_payment_id: p.payment_id, p_reason: 'wrong customer' });
    await rpc(g.cashier, 'receive_payment', { p_shop_id: g.shop, p_idempotency_key: key(), p_customer_id: c2, p_amount_paise: R(300), p_method: 'upi' });
    await rpc(g.owner, 'issue_credit_or_return', { p_shop_id: g.shop, p_idempotency_key: key(), p_customer_id: c1, p_amount_paise: R(15), p_reason: 'return', p_invoice_id: b1.invoice_id });
    const x = await bill(g, g.cashier, c1, R(60), 0);
    await rpc(g.owner, 'reverse_invoice', { p_shop_id: g.shop, p_idempotency_key: key(), p_invoice_id: x.invoice_id, p_reason: 'duplicate' });

    const s = await rpc(g.owner, 'get_shop_daily_summary', { p_shop_id: g.shop });
    const q = async (sql: string) => Number((await admin(sql, [g.shop])).rows[0].v);
    const invPosted = await q(`select coalesce(sum(total_paise),0) v from public.invoices where shop_id = $1`);
    const invReversed = await q(`select coalesce(sum(total_paise),0) v from public.invoices where shop_id = $1 and status = 'reversed'`);
    const credits = await q(`select coalesce(sum(amount_paise),0) v from public.credit_notes where shop_id = $1 and status = 'posted'`);
    const payAll = await q(`select coalesce(sum(amount_paise),0) v from public.payments where shop_id = $1`);
    const payRev = await q(`select coalesce(sum(amount_paise),0) v from public.payments where shop_id = $1 and status = 'reversed'`);
    const upi = await q(`select coalesce(sum(amount_paise),0) v from public.payments where shop_id = $1 and status = 'posted' and method = 'upi'`);
    const cash = await q(`select coalesce(sum(amount_paise),0) v from public.payments where shop_id = $1 and status = 'posted' and method = 'cash'`);
    const due = await q(`select coalesce(sum(amount_paise),0) v from public.ledger_entries where shop_id = $1 and customer_id is not null`);

    expect(s.sales_gross_paise).toBe(invPosted);
    expect(s.sales_reversed_paise).toBe(invReversed);
    expect(s.net_sales_paise).toBe(invPosted - invReversed - credits);
    expect(s.net_sales_paise).toBe(R(315 + 1200 + 80 - 15));
    expect(s.net_collections_paise).toBe(payAll - payRev);
    expect(s.net_collections_paise).toBe(R(200 + 80 + 300));
    expect(s.upi_paise).toBe(upi);
    expect(s.cash_paise).toBe(cash);
    expect(s.cash_paise + s.upi_paise + s.other_paise).toBe(s.net_collections_paise);
    expect(s.total_outstanding_paise).toBe(due);
    expect(s.total_outstanding_paise).toBe(R(250 + 115 - 15 + 900));
    expect(s.customers_with_due).toBe(2);
    expect((await rpc(g.owner, 'reconcile_shop', { p_shop_id: g.shop })).ok).toBe(true);

    const today = s.date;
    const rep = await rpc(g.owner, 'get_report', { p_shop_id: g.shop, p_from: today, p_to: today });
    expect(rep.totals.net_sales_paise).toBe(s.net_sales_paise);
    expect(rep.days).toHaveLength(1);
    expect(rep.bills).toHaveLength(4);
    const st = await rpc(g.owner, 'get_customer_ledger', { p_shop_id: g.shop, p_customer_id: c1 });
    expect(st.entries.at(-1).running_paise).toBe(st.balance_paise);
  });
});
