-- Financial posting. Every function here:
--   1. identifies the caller (auth.uid) and re-checks live membership + role,
--   2. validates that every referenced record belongs to the same shop,
--   3. runs in ONE transaction (the function call) with the customer row locked,
--   4. is idempotent on (shop_id, idempotency_key),
--   5. writes ledger entries, allocations and the balance cache atomically.
--
-- ROUNDING POLICY (deterministic, documented in docs/ACCOUNTING.md):
--   line gross = qty x unit_price, converted between units with exact integer ratios, rounded
--   half-up to the nearest paisa. Bill total = sum of line totals. Nothing is rounded to a rupee.
--
-- OVERPAYMENT POLICY: rejected. A customer can never have a negative (advance) balance.

-- ---------------------------------------------------------------- validation helpers
create or replace function app_private.check_amount(p bigint, p_allow_zero boolean default false)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p < 0 or (p = 0 and not p_allow_zero) or p > 100000000000 then
    perform app_private.fail('INVALID_AMOUNT', 'amount must be whole paise, positive and within range');
  end if;
end $$;

-- Integer paise out of a JSON value: must be a JSON number with no fractional part.
create or replace function app_private.jpaise(p jsonb)
returns bigint language plpgsql immutable set search_path = '' as $$
declare
  n numeric;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'number' then perform app_private.fail('INVALID_AMOUNT', 'paise must be a number'); end if;
  n := (p #>> '{}')::numeric;
  if n <> trunc(n) or n < 0 or n > 100000000000 then
    perform app_private.fail('INVALID_AMOUNT', 'paise must be a whole number within range');
  end if;
  return n::bigint;
end $$;

-- Quantity: up to 6 integer digits and at most 3 decimals; anything else is rejected, not rounded.
create or replace function app_private.jqty(p jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  t text := p #>> '{}';
  q numeric;
begin
  if t is null or t !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' then
    perform app_private.fail('INVALID_QUANTITY', 'quantity must be a positive number with at most 3 decimals');
  end if;
  q := t::numeric;
  if q <= 0 or q > 100000 then perform app_private.fail('INVALID_QUANTITY', 'quantity out of range'); end if;
  return q;
end $$;

-- Exact unit conversion ratio from p_from to p_to as (num, den); null when not convertible.
create or replace function app_private.unit_ratio(p_from text, p_to text, out num bigint, out den bigint)
language plpgsql immutable set search_path = '' as $$
begin
  if p_from = p_to then num := 1; den := 1;
  elsif p_from = 'g' and p_to = 'kg' then num := 1; den := 1000;
  elsif p_from = 'kg' and p_to = 'g' then num := 1000; den := 1;
  elsif p_from = 'ml' and p_to = 'litre' then num := 1; den := 1000;
  elsif p_from = 'litre' and p_to = 'ml' then num := 1000; den := 1;
  elsif p_from = 'piece' and p_to = 'dozen' then num := 1; den := 12;
  elsif p_from = 'dozen' and p_to = 'piece' then num := 12; den := 1;
  else num := null; den := null;
  end if;
end $$;

-- qty (in p_unit) x price (paise per p_price_unit) -> paise, half-up, using integers only.
create or replace function app_private.line_gross(p_qty numeric, p_unit text, p_price_unit text, p_unit_price bigint)
returns bigint language plpgsql immutable set search_path = '' as $$
declare
  r record;
  n numeric;
  d numeric;
begin
  select * into r from app_private.unit_ratio(p_unit, p_price_unit);
  if r.num is null then
    perform app_private.fail('UNIT_MISMATCH', p_unit || ' cannot be priced per ' || p_price_unit);
  end if;
  n := (p_qty * 1000)::numeric * r.num * p_unit_price;   -- exact integer (qty has <= 3 decimals)
  d := r.den::numeric * 1000;
  return div(2 * n + d, 2 * d)::bigint;                   -- round half up
end $$;

-- ---------------------------------------------------------------- idempotency
-- Returns the stored result when this key was already processed, otherwise null (and reserves the
-- key inside the caller's transaction, so a concurrent duplicate waits and then replays).
create or replace function app_private.begin_mutation(p_shop uuid, p_key uuid, p_op text, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.client_mutations;
begin
  if p_key is null then perform app_private.fail('IDEMPOTENCY_KEY_REQUIRED'); end if;
  insert into public.client_mutations(shop_id, idempotency_key, operation, request_hash, user_id)
  values (p_shop, p_key, p_op, p_hash, auth.uid())
  on conflict (shop_id, idempotency_key) do nothing;
  if found then return null; end if;
  select * into v from public.client_mutations m where m.shop_id = p_shop and m.idempotency_key = p_key;
  if v.operation <> p_op or v.request_hash <> p_hash or v.user_id <> auth.uid() then
    perform app_private.fail('IDEMPOTENCY_KEY_REUSED', 'this key was already used for a different request');
  end if;
  if v.result is null then perform app_private.fail('MUTATION_IN_PROGRESS'); end if;
  return v.result || jsonb_build_object('replayed', true);
end $$;

create or replace function app_private.finish_mutation(p_shop uuid, p_key uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.client_mutations m set result = p_result, completed_at = now()
  where m.shop_id = p_shop and m.idempotency_key = p_key;
  return p_result || jsonb_build_object('replayed', false);
end $$;

-- ---------------------------------------------------------------- internal posting primitives
create or replace function app_private.lock_customer(p_shop uuid, p_customer uuid, p_require_active boolean default true)
returns public.customers language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
begin
  select * into c from public.customers x where x.id = p_customer and x.shop_id = p_shop for update;
  if not found then perform app_private.fail('CUSTOMER_NOT_FOUND'); end if;
  if p_require_active and not c.is_active then perform app_private.fail('CUSTOMER_INACTIVE'); end if;
  return c;
end $$;

create or replace function app_private.balance_of(p_customer uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select b.balance_paise from public.customer_balances b where b.customer_id = p_customer), 0);
$$;

create or replace function app_private.invoice_outstanding(p_invoice uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when i.status = 'posted'
    then i.total_paise - coalesce((select sum(a.amount_paise) from public.payment_allocations a where a.invoice_id = i.id), 0)
    else 0 end
  from public.invoices i where i.id = p_invoice;
$$;

create or replace function app_private.opening_outstanding(p_customer uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(l.amount_paise) from public.ledger_entries l
                   where l.customer_id = p_customer and l.entry_type = 'opening_balance'), 0)
       - coalesce((select sum(a.amount_paise) from public.payment_allocations a
                   where a.customer_id = p_customer and a.target = 'opening'), 0);
$$;

-- Applies an amount to the customer's dues: preferred invoice first (if any), then the opening
-- balance, then posted invoices oldest first. Returns whatever could not be applied.
create or replace function app_private.allocate(p_shop uuid, p_customer uuid, p_payment uuid, p_credit uuid, p_amount bigint, p_prefer_invoice uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_rem bigint := p_amount;
  v_take bigint;
  r record;
begin
  if p_prefer_invoice is not null and v_rem > 0 then
    v_take := least(v_rem, greatest(coalesce(app_private.invoice_outstanding(p_prefer_invoice), 0), 0));
    if v_take > 0 then
      insert into public.payment_allocations(shop_id, customer_id, payment_id, credit_note_id, target, invoice_id, amount_paise)
      values (p_shop, p_customer, p_payment, p_credit, 'invoice', p_prefer_invoice, v_take);
      v_rem := v_rem - v_take;
    end if;
  end if;
  if p_customer is null then return v_rem; end if;
  if v_rem > 0 then
    v_take := least(v_rem, greatest(app_private.opening_outstanding(p_customer), 0));
    if v_take > 0 then
      insert into public.payment_allocations(shop_id, customer_id, payment_id, credit_note_id, target, amount_paise)
      values (p_shop, p_customer, p_payment, p_credit, 'opening', v_take);
      v_rem := v_rem - v_take;
    end if;
  end if;
  if v_rem > 0 then
    for r in
      select i.id, i.total_paise - coalesce(sum(a.amount_paise), 0) as outstanding
      from public.invoices i left join public.payment_allocations a on a.invoice_id = i.id
      where i.shop_id = p_shop and i.customer_id = p_customer and i.status = 'posted'
      group by i.id
      having i.total_paise - coalesce(sum(a.amount_paise), 0) > 0
      order by i.posted_at, i.invoice_no
    loop
      exit when v_rem = 0;
      v_take := least(v_rem, r.outstanding);
      insert into public.payment_allocations(shop_id, customer_id, payment_id, credit_note_id, target, invoice_id, amount_paise)
      values (p_shop, p_customer, p_payment, p_credit, 'invoice', r.id, v_take);
      v_rem := v_rem - v_take;
    end loop;
  end if;
  return v_rem;
end $$;

-- Releases (negates) the net allocations of one payment or credit, optionally only on one invoice.
-- Returns the amount released.
create or replace function app_private.release_allocations(p_payment uuid, p_credit uuid, p_only_invoice uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_total bigint := 0;
begin
  for r in
    select a.shop_id, a.customer_id, a.target, a.invoice_id, sum(a.amount_paise) as net, min(a.id::text)::uuid as first_id
    from public.payment_allocations a
    where ((p_payment is not null and a.payment_id = p_payment) or (p_credit is not null and a.credit_note_id = p_credit))
      and (p_only_invoice is null or a.invoice_id = p_only_invoice)
    group by a.shop_id, a.customer_id, a.target, a.invoice_id
    having sum(a.amount_paise) <> 0
  loop
    insert into public.payment_allocations(shop_id, customer_id, payment_id, credit_note_id, target, invoice_id, amount_paise, reverses_id)
    values (r.shop_id, r.customer_id, p_payment, p_credit, r.target, r.invoice_id, -r.net, r.first_id);
    v_total := v_total + r.net;
  end loop;
  return v_total;
end $$;

create or replace function app_private.post_payment(
  p_shop uuid, p_customer uuid, p_invoice uuid, p_kind text, p_amount bigint, p_method text,
  p_reference text, p_note text, p_date date, p_uid uuid, p_prev_balance bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_no bigint;
  v_rem bigint;
begin
  update public.shops s set payment_seq = s.payment_seq + 1 where s.id = p_shop returning s.payment_seq into v_no;
  insert into public.payments(id, shop_id, payment_no, customer_id, invoice_id, kind, amount_paise, method, reference, note,
                              previous_balance_paise, balance_after_paise, business_date, created_by)
  values (v_id, p_shop, v_no, p_customer, p_invoice, p_kind, p_amount, p_method, nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''),
          p_prev_balance, greatest(p_prev_balance - p_amount, 0), p_date, p_uid);
  if p_kind = 'bill_payment' then
    insert into public.payment_allocations(shop_id, customer_id, payment_id, target, invoice_id, amount_paise)
    values (p_shop, p_customer, v_id, 'invoice', p_invoice, p_amount);
  else
    v_rem := app_private.allocate(p_shop, p_customer, v_id, null, p_amount);
    if v_rem > 0 then perform app_private.fail('OVERPAYMENT', 'payment is more than the customer owes'); end if;
  end if;
  insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, payment_id, business_date, created_by)
  values (p_shop, p_customer, 'payment', -p_amount, v_id, p_date, p_uid);
  return v_id;
end $$;

-- ---------------------------------------------------------------- create_invoice
create or replace function public.create_invoice(
  p_shop_id uuid, p_idempotency_key uuid, p_customer_id uuid, p_items jsonb, p_paid_paise bigint,
  p_payment_method text default 'cash', p_payment_reference text default null, p_note text default null,
  p_source text default 'manual', p_ocr_job_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_cust public.customers;
  v_prev bigint := 0;
  v_item jsonb;
  v_line int := 0;
  v_qty numeric; v_unit text; v_punit text; v_price bigint; v_disc bigint; v_gross bigint;
  v_pid uuid; v_name text; v_prod public.products;
  v_sub bigint := 0; v_disc_total bigint := 0; v_total bigint;
  v_rows jsonb := '[]'::jsonb;
  v_invoice uuid := gen_random_uuid();
  v_no bigint; v_date date;
  v_bill_paid bigint; v_extra bigint; v_after bigint;
  v_payments uuid[] := '{}';
  v_result jsonb;
begin
  perform app_private.require_role(p_shop_id, 'cashier', true);
  perform app_private.check_amount(p_paid_paise, true);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform app_private.fail('EMPTY_BILL', 'a bill needs at least one item');
  end if;
  if jsonb_array_length(p_items) > 200 then perform app_private.fail('TOO_MANY_ITEMS'); end if;
  if p_payment_method not in ('cash','upi','other') then perform app_private.fail('INVALID_METHOD'); end if;
  if p_source not in ('manual','ocr') then perform app_private.fail('INVALID_SOURCE'); end if;
  if length(coalesce(p_payment_reference, '')) > 80 or length(coalesce(p_note, '')) > 300 then
    perform app_private.fail('TEXT_TOO_LONG');
  end if;

  v_replay := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'create_invoice',
    md5(jsonb_build_object('c', p_customer_id, 'i', p_items, 'p', p_paid_paise, 'm', p_payment_method,
                           'r', p_payment_reference, 'n', p_note, 's', p_source)::text));
  if v_replay is not null then return v_replay; end if;

  if p_customer_id is not null then
    v_cust := app_private.lock_customer(p_shop_id, p_customer_id);
    v_prev := app_private.balance_of(p_customer_id);
  end if;
  if p_ocr_job_id is not null and not exists
     (select 1 from public.ocr_jobs o where o.id = p_ocr_job_id and o.shop_id = p_shop_id) then
    perform app_private.fail('OCR_JOB_NOT_FOUND');
  end if;

  -- Totals are computed here from quantities and unit prices. Client-side totals are never read.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    if jsonb_typeof(v_item) <> 'object' then perform app_private.fail('INVALID_ITEM'); end if;
    v_qty := app_private.jqty(v_item -> 'qty');
    v_unit := v_item ->> 'unit';
    v_punit := coalesce(v_item ->> 'price_unit', v_unit);
    if v_unit is null or v_unit not in ('kg','g','litre','ml','packet','piece','dozen')
       or v_punit not in ('kg','g','litre','ml','packet','piece','dozen') then
      perform app_private.fail('INVALID_UNIT', 'line ' || v_line);
    end if;
    v_price := app_private.jpaise(v_item -> 'unit_price_paise');
    if v_price is null or v_price > 1000000000 then
      perform app_private.fail('PRICE_REQUIRED', 'line ' || v_line || ' has no valid unit price');
    end if;
    v_disc := coalesce(app_private.jpaise(v_item -> 'discount_paise'), 0);
    v_gross := app_private.line_gross(v_qty, v_unit, v_punit, v_price);
    if v_disc > v_gross then perform app_private.fail('DISCOUNT_TOO_LARGE', 'line ' || v_line); end if;
    v_pid := nullif(v_item ->> 'product_id', '')::uuid;
    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    if v_pid is not null then
      select * into v_prod from public.products p where p.id = v_pid and p.shop_id = p_shop_id;
      if not found then perform app_private.fail('PRODUCT_NOT_FOUND', 'line ' || v_line); end if;
      v_name := coalesce(v_name, v_prod.name);
    end if;
    if v_name is null or length(v_name) > 120 then perform app_private.fail('ITEM_NAME_REQUIRED', 'line ' || v_line); end if;
    v_sub := v_sub + v_gross;
    v_disc_total := v_disc_total + v_disc;
    v_rows := v_rows || jsonb_build_object('line_no', v_line, 'product_id', v_pid, 'name', v_name, 'qty', v_qty,
      'unit', v_unit, 'price_unit', v_punit, 'unit_price_paise', v_price, 'gross_paise', v_gross,
      'discount_paise', v_disc, 'line_total_paise', v_gross - v_disc);
  end loop;
  v_total := v_sub - v_disc_total;
  if v_total <= 0 then perform app_private.fail('INVALID_TOTAL', 'bill total must be more than zero'); end if;
  if v_total > 100000000000 then perform app_private.fail('INVALID_AMOUNT', 'bill total out of range'); end if;

  if p_customer_id is null then
    if p_paid_paise <> v_total then
      perform app_private.fail('WALKIN_MUST_SETTLE', 'walk-in bills must be paid in full or linked to a customer');
    end if;
  elsif p_paid_paise > v_total + v_prev then
    perform app_private.fail('OVERPAYMENT', 'received amount is more than this bill plus previous dues');
  end if;
  v_bill_paid := least(p_paid_paise, v_total);
  v_extra := p_paid_paise - v_bill_paid;
  v_after := v_prev + v_total - p_paid_paise;

  v_date := app_private.shop_today(p_shop_id);
  update public.shops s set invoice_seq = s.invoice_seq + 1 where s.id = p_shop_id returning s.invoice_seq into v_no;

  insert into public.invoices(id, shop_id, invoice_no, customer_id, customer_name, subtotal_paise, discount_paise, total_paise,
    paid_at_posting_paise, old_dues_paid_paise, previous_balance_paise, balance_after_paise, source, ocr_job_id, note,
    business_date, created_by)
  values (v_invoice, p_shop_id, v_no, p_customer_id, v_cust.name, v_sub, v_disc_total, v_total, v_bill_paid, v_extra, v_prev,
    v_after, p_source, p_ocr_job_id, nullif(btrim(p_note), ''), v_date, v_uid);

  insert into public.invoice_items(shop_id, invoice_id, line_no, product_id, name, qty, unit, price_unit, unit_price_paise,
    gross_paise, discount_paise, line_total_paise)
  select p_shop_id, v_invoice, x.line_no, x.product_id, x.name, x.qty, x.unit, x.price_unit, x.unit_price_paise,
    x.gross_paise, x.discount_paise, x.line_total_paise
  from jsonb_to_recordset(v_rows) as x(line_no int, product_id uuid, name text, qty numeric, unit text, price_unit text,
    unit_price_paise bigint, gross_paise bigint, discount_paise bigint, line_total_paise bigint);

  insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, invoice_id, business_date, created_by)
  values (p_shop_id, p_customer_id, 'invoice', v_total, v_invoice, v_date, v_uid);

  if v_bill_paid > 0 then
    v_payments := v_payments || app_private.post_payment(p_shop_id, p_customer_id, v_invoice, 'bill_payment', v_bill_paid,
      p_payment_method, p_payment_reference, null, v_date, v_uid, v_prev + v_total);
  end if;
  if v_extra > 0 then
    -- Money beyond this bill is an old-dues collection, never extra sales.
    v_payments := v_payments || app_private.post_payment(p_shop_id, p_customer_id, null, 'collection', v_extra,
      p_payment_method, p_payment_reference, null, v_date, v_uid, v_prev + v_total - v_bill_paid);
  end if;

  perform app_private.audit(p_shop_id, v_uid, 'invoice.posted', 'invoice', v_invoice::text,
    jsonb_build_object('invoice_no', v_no, 'total_paise', v_total, 'paid_paise', p_paid_paise, 'source', p_source));

  v_result := jsonb_build_object('invoice_id', v_invoice, 'invoice_no', v_no, 'customer_id', p_customer_id,
    'total_paise', v_total, 'paid_paise', p_paid_paise, 'bill_paid_paise', v_bill_paid, 'old_dues_paid_paise', v_extra,
    'bill_due_paise', v_total - v_bill_paid, 'previous_balance_paise', v_prev, 'new_balance_paise', v_after,
    'payment_ids', to_jsonb(v_payments));
  return app_private.finish_mutation(p_shop_id, p_idempotency_key, v_result);
end $$;

-- ---------------------------------------------------------------- receive_payment (old dues)
create or replace function public.receive_payment(
  p_shop_id uuid, p_idempotency_key uuid, p_customer_id uuid, p_amount_paise bigint,
  p_method text default 'cash', p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_prev bigint;
  v_id uuid;
  v_result jsonb;
begin
  perform app_private.require_role(p_shop_id, 'cashier', true);
  perform app_private.check_amount(p_amount_paise);
  if p_method not in ('cash','upi','other') then perform app_private.fail('INVALID_METHOD'); end if;
  if p_customer_id is null then perform app_private.fail('CUSTOMER_NOT_FOUND'); end if;
  if length(coalesce(p_reference, '')) > 80 or length(coalesce(p_note, '')) > 300 then
    perform app_private.fail('TEXT_TOO_LONG');
  end if;
  v_replay := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'receive_payment',
    md5(jsonb_build_object('c', p_customer_id, 'a', p_amount_paise, 'm', p_method, 'r', p_reference, 'n', p_note)::text));
  if v_replay is not null then return v_replay; end if;

  perform app_private.lock_customer(p_shop_id, p_customer_id, false);
  v_prev := app_private.balance_of(p_customer_id);
  if p_amount_paise > v_prev then
    perform app_private.fail('OVERPAYMENT', 'customer owes ' || v_prev || ' paise; cannot receive more than that');
  end if;
  v_id := app_private.post_payment(p_shop_id, p_customer_id, null, 'collection', p_amount_paise, p_method, p_reference,
    p_note, app_private.shop_today(p_shop_id), v_uid, v_prev);
  perform app_private.audit(p_shop_id, v_uid, 'payment.posted', 'payment', v_id::text,
    jsonb_build_object('amount_paise', p_amount_paise, 'method', p_method));
  v_result := jsonb_build_object('payment_id', v_id,
    'payment_no', (select p.payment_no from public.payments p where p.id = v_id),
    'customer_id', p_customer_id, 'amount_paise', p_amount_paise,
    'previous_balance_paise', v_prev, 'new_balance_paise', v_prev - p_amount_paise);
  return app_private.finish_mutation(p_shop_id, p_idempotency_key, v_result);
end $$;

-- ---------------------------------------------------------------- reverse_payment
create or replace function public.reverse_payment(p_shop_id uuid, p_idempotency_key uuid, p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_pay public.payments;
  v_result jsonb;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform app_private.fail('REASON_REQUIRED'); end if;
  v_replay := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'reverse_payment',
    md5(jsonb_build_object('p', p_payment_id, 'r', p_reason)::text));
  if v_replay is not null then return v_replay; end if;

  select * into v_pay from public.payments p where p.id = p_payment_id and p.shop_id = p_shop_id;
  if not found then perform app_private.fail('PAYMENT_NOT_FOUND'); end if;
  if v_pay.customer_id is null then
    perform app_private.fail('USE_INVOICE_REVERSAL', 'a walk-in bill payment is reversed by reversing its bill');
  end if;
  perform app_private.lock_customer(p_shop_id, v_pay.customer_id, false);
  select * into v_pay from public.payments p where p.id = p_payment_id for update;
  if v_pay.status <> 'posted' then perform app_private.fail('ALREADY_REVERSED'); end if;

  perform app_private.release_allocations(p_payment_id, null);
  update public.payments p set status = 'reversed', reversed_at = now(), reversed_by = v_uid, reversal_reason = btrim(p_reason)
  where p.id = p_payment_id;
  insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, payment_id, business_date, created_by, note)
  values (p_shop_id, v_pay.customer_id, 'payment_reversal', v_pay.amount_paise, p_payment_id,
          app_private.shop_today(p_shop_id), v_uid, btrim(p_reason));
  perform app_private.audit(p_shop_id, v_uid, 'payment.reversed', 'payment', p_payment_id::text,
    jsonb_build_object('amount_paise', v_pay.amount_paise, 'reason', btrim(p_reason)));
  v_result := jsonb_build_object('payment_id', p_payment_id, 'reversed', true, 'amount_paise', v_pay.amount_paise,
    'customer_id', v_pay.customer_id, 'new_balance_paise', app_private.balance_of(v_pay.customer_id));
  return app_private.finish_mutation(p_shop_id, p_idempotency_key, v_result);
end $$;

-- ---------------------------------------------------------------- reverse_invoice
-- Cancels a posted bill. Money taken while billing is reversed with it (refund). Later collections
-- or credits that had been applied to this bill are moved to the customer's other dues; if they do
-- not fit, the reversal is refused and the owner must reverse that payment first.
create or replace function public.reverse_invoice(p_shop_id uuid, p_idempotency_key uuid, p_invoice_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_inv public.invoices;
  v_date date;
  v_refunded bigint := 0;
  v_amt bigint; v_rem bigint;
  r record;
  v_result jsonb;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform app_private.fail('REASON_REQUIRED'); end if;
  v_replay := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'reverse_invoice',
    md5(jsonb_build_object('i', p_invoice_id, 'r', p_reason)::text));
  if v_replay is not null then return v_replay; end if;

  select * into v_inv from public.invoices i where i.id = p_invoice_id and i.shop_id = p_shop_id;
  if not found then perform app_private.fail('INVOICE_NOT_FOUND'); end if;
  if v_inv.customer_id is not null then
    perform app_private.lock_customer(p_shop_id, v_inv.customer_id, false);
  end if;
  select * into v_inv from public.invoices i where i.id = p_invoice_id for update;
  if v_inv.status <> 'posted' then perform app_private.fail('ALREADY_REVERSED'); end if;
  if exists (select 1 from public.credit_notes c where c.invoice_id = p_invoice_id and c.status = 'posted') then
    perform app_private.fail('INVOICE_HAS_CREDITS', 'reverse the return/credit on this bill first');
  end if;
  v_date := app_private.shop_today(p_shop_id);

  update public.invoices i set status = 'reversed', reversed_at = now(), reversed_by = v_uid, reversal_reason = btrim(p_reason)
  where i.id = p_invoice_id;

  -- 1. Money taken while billing: reverse it together with the bill.
  for r in select p.* from public.payments p
           where p.invoice_id = p_invoice_id and p.kind = 'bill_payment' and p.status = 'posted' order by p.payment_no loop
    perform app_private.release_allocations(r.id, null);
    update public.payments p set status = 'reversed', reversed_at = now(), reversed_by = v_uid,
      reversal_reason = 'bill reversed: ' || btrim(p_reason) where p.id = r.id;
    insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, payment_id, business_date, created_by, note)
    values (p_shop_id, r.customer_id, 'payment_reversal', r.amount_paise, r.id, v_date, v_uid, 'bill reversed');
    v_refunded := v_refunded + r.amount_paise;
  end loop;

  -- 2. Collections / credits applied to this bill later: move them to the customer's other dues.
  for r in select a.payment_id, a.credit_note_id, sum(a.amount_paise) as net
           from public.payment_allocations a where a.invoice_id = p_invoice_id
           group by a.payment_id, a.credit_note_id having sum(a.amount_paise) <> 0 loop
    v_amt := app_private.release_allocations(r.payment_id, r.credit_note_id, p_invoice_id);
    v_rem := app_private.allocate(p_shop_id, v_inv.customer_id, r.payment_id, r.credit_note_id, v_amt);
    if v_rem > 0 then
      perform app_private.fail('PAYMENT_EXCEEDS_DUES',
        'a later payment was applied to this bill; reverse that payment first, then reverse the bill');
    end if;
  end loop;

  insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, invoice_id, business_date, created_by, note)
  values (p_shop_id, v_inv.customer_id, 'invoice_reversal', -v_inv.total_paise, p_invoice_id, v_date, v_uid, btrim(p_reason));
  perform app_private.audit(p_shop_id, v_uid, 'invoice.reversed', 'invoice', p_invoice_id::text,
    jsonb_build_object('invoice_no', v_inv.invoice_no, 'total_paise', v_inv.total_paise, 'refunded_paise', v_refunded,
                       'reason', btrim(p_reason)));
  v_result := jsonb_build_object('invoice_id', p_invoice_id, 'invoice_no', v_inv.invoice_no, 'reversed', true,
    'total_paise', v_inv.total_paise, 'refunded_paise', v_refunded, 'customer_id', v_inv.customer_id,
    'new_balance_paise', case when v_inv.customer_id is null then 0 else app_private.balance_of(v_inv.customer_id) end);
  return app_private.finish_mutation(p_shop_id, p_idempotency_key, v_result);
end $$;

-- ---------------------------------------------------------------- issue_credit_or_return
create or replace function public.issue_credit_or_return(
  p_shop_id uuid, p_idempotency_key uuid, p_customer_id uuid, p_amount_paise bigint, p_reason text,
  p_kind text default 'return', p_invoice_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_prev bigint;
  v_inv public.invoices;
  v_used bigint;
  v_id uuid := gen_random_uuid();
  v_date date;
  v_rem bigint;
  v_result jsonb;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  perform app_private.check_amount(p_amount_paise);
  if p_kind not in ('return','credit') then perform app_private.fail('INVALID_KIND'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 300 then perform app_private.fail('REASON_REQUIRED'); end if;
  if p_customer_id is null then perform app_private.fail('CUSTOMER_NOT_FOUND'); end if;
  v_replay := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'issue_credit_or_return',
    md5(jsonb_build_object('c', p_customer_id, 'a', p_amount_paise, 'r', p_reason, 'k', p_kind, 'i', p_invoice_id)::text));
  if v_replay is not null then return v_replay; end if;

  perform app_private.lock_customer(p_shop_id, p_customer_id, false);
  v_prev := app_private.balance_of(p_customer_id);
  if p_amount_paise > v_prev then
    perform app_private.fail('CREDIT_EXCEEDS_DUES',
      'credit is more than the customer owes; to refund a paid bill, reverse the bill instead');
  end if;
  if p_invoice_id is not null then
    select * into v_inv from public.invoices i
    where i.id = p_invoice_id and i.shop_id = p_shop_id and i.customer_id = p_customer_id;
    if not found then perform app_private.fail('INVOICE_NOT_FOUND'); end if;
    if v_inv.status <> 'posted' then perform app_private.fail('ALREADY_REVERSED'); end if;
    select coalesce(sum(c.amount_paise), 0) into v_used from public.credit_notes c
    where c.invoice_id = p_invoice_id and c.status = 'posted';
    if p_amount_paise > v_inv.total_paise - v_used then
      perform app_private.fail('CREDIT_EXCEEDS_INVOICE', 'credit is more than the remaining value of this bill');
    end if;
  end if;
  v_date := app_private.shop_today(p_shop_id);
  insert into public.credit_notes(id, shop_id, customer_id, invoice_id, kind, amount_paise, reason, business_date, created_by)
  values (v_id, p_shop_id, p_customer_id, p_invoice_id, p_kind, p_amount_paise, btrim(p_reason), v_date, v_uid);
  v_rem := app_private.allocate(p_shop_id, p_customer_id, null, v_id, p_amount_paise, p_invoice_id);
  if v_rem > 0 then perform app_private.fail('CREDIT_EXCEEDS_DUES'); end if;
  insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, credit_note_id, business_date, created_by, note)
  values (p_shop_id, p_customer_id, 'credit', -p_amount_paise, v_id, v_date, v_uid, btrim(p_reason));
  perform app_private.audit(p_shop_id, v_uid, 'credit.posted', 'credit_note', v_id::text,
    jsonb_build_object('amount_paise', p_amount_paise, 'kind', p_kind, 'invoice_id', p_invoice_id, 'reason', btrim(p_reason)));
  v_result := jsonb_build_object('credit_note_id', v_id, 'customer_id', p_customer_id, 'amount_paise', p_amount_paise,
    'previous_balance_paise', v_prev, 'new_balance_paise', v_prev - p_amount_paise);
  return app_private.finish_mutation(p_shop_id, p_idempotency_key, v_result);
end $$;

create or replace function public.reverse_credit(p_shop_id uuid, p_idempotency_key uuid, p_credit_note_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_cn public.credit_notes;
  v_result jsonb;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform app_private.fail('REASON_REQUIRED'); end if;
  v_replay := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'reverse_credit',
    md5(jsonb_build_object('c', p_credit_note_id, 'r', p_reason)::text));
  if v_replay is not null then return v_replay; end if;
  select * into v_cn from public.credit_notes c where c.id = p_credit_note_id and c.shop_id = p_shop_id;
  if not found then perform app_private.fail('CREDIT_NOT_FOUND'); end if;
  perform app_private.lock_customer(p_shop_id, v_cn.customer_id, false);
  select * into v_cn from public.credit_notes c where c.id = p_credit_note_id for update;
  if v_cn.status <> 'posted' then perform app_private.fail('ALREADY_REVERSED'); end if;
  perform app_private.release_allocations(null, p_credit_note_id);
  update public.credit_notes c set status = 'reversed', reversed_at = now(), reversed_by = v_uid, reversal_reason = btrim(p_reason)
  where c.id = p_credit_note_id;
  insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, credit_note_id, business_date, created_by, note)
  values (p_shop_id, v_cn.customer_id, 'credit_reversal', v_cn.amount_paise, p_credit_note_id,
          app_private.shop_today(p_shop_id), v_uid, btrim(p_reason));
  perform app_private.audit(p_shop_id, v_uid, 'credit.reversed', 'credit_note', p_credit_note_id::text,
    jsonb_build_object('amount_paise', v_cn.amount_paise, 'reason', btrim(p_reason)));
  v_result := jsonb_build_object('credit_note_id', p_credit_note_id, 'reversed', true, 'customer_id', v_cn.customer_id,
    'new_balance_paise', app_private.balance_of(v_cn.customer_id));
  return app_private.finish_mutation(p_shop_id, p_idempotency_key, v_result);
end $$;

-- ---------------------------------------------------------------- opening balance
-- Sets the customer's opening balance (what they owed before the shop started using the app).
-- Posts the difference as a labelled ledger entry; owner only; audited.
create or replace function public.set_opening_balance(
  p_shop_id uuid, p_idempotency_key uuid, p_customer_id uuid, p_amount_paise bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_current bigint;
  v_delta bigint;
  v_result jsonb;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  perform app_private.check_amount(p_amount_paise, true);
  v_replay := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'set_opening_balance',
    md5(jsonb_build_object('c', p_customer_id, 'a', p_amount_paise, 'n', p_note)::text));
  if v_replay is not null then return v_replay; end if;
  perform app_private.lock_customer(p_shop_id, p_customer_id, false);
  select coalesce(sum(l.amount_paise), 0) into v_current from public.ledger_entries l
  where l.customer_id = p_customer_id and l.entry_type = 'opening_balance';
  v_delta := p_amount_paise - v_current;
  if v_delta < 0 and -v_delta > app_private.opening_outstanding(p_customer_id) then
    perform app_private.fail('OPENING_ALREADY_PAID', 'part of the opening balance has already been paid');
  end if;
  if v_delta <> 0 then
    insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, business_date, created_by, note)
    values (p_shop_id, p_customer_id, 'opening_balance', v_delta, app_private.shop_today(p_shop_id), v_uid,
            nullif(btrim(coalesce(p_note, '')), ''));
    perform app_private.audit(p_shop_id, v_uid, 'customer.opening_balance', 'customer', p_customer_id::text,
      jsonb_build_object('previous_paise', v_current, 'new_paise', p_amount_paise));
  end if;
  v_result := jsonb_build_object('customer_id', p_customer_id, 'opening_balance_paise', p_amount_paise,
    'new_balance_paise', app_private.balance_of(p_customer_id));
  return app_private.finish_mutation(p_shop_id, p_idempotency_key, v_result);
end $$;

-- ---------------------------------------------------------------- balances, reconciliation, status
create or replace function public.get_customer_balance(p_shop_id uuid, p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.shop_id = p_shop_id) then
    perform app_private.fail('CUSTOMER_NOT_FOUND');
  end if;
  return jsonb_build_object('customer_id', p_customer_id, 'balance_paise',
    coalesce((select sum(l.amount_paise) from public.ledger_entries l
              where l.shop_id = p_shop_id and l.customer_id = p_customer_id), 0));
end $$;

-- Compares three independent views of what a customer owes: the cache, the ledger sum, and the
-- sum of unpaid documents. All three must be equal.
create or replace function app_private.reconcile_one(p_shop uuid, p_customer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with v as (
    select
      app_private.balance_of(p_customer) as cached,
      coalesce((select sum(l.amount_paise) from public.ledger_entries l
                where l.shop_id = p_shop and l.customer_id = p_customer), 0)::bigint as ledger,
      (app_private.opening_outstanding(p_customer)
        + coalesce((select sum(app_private.invoice_outstanding(i.id)) from public.invoices i
                    where i.shop_id = p_shop and i.customer_id = p_customer and i.status = 'posted'), 0))::bigint as documents
  )
  select jsonb_build_object('customer_id', p_customer, 'cached_paise', cached, 'ledger_paise', ledger,
    'documents_paise', documents, 'ok', cached = ledger and ledger = documents)
  from v;
$$;

create or replace function public.reconcile_customer_ledger(p_shop_id uuid, p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.shop_id = p_shop_id) then
    perform app_private.fail('CUSTOMER_NOT_FOUND');
  end if;
  return app_private.reconcile_one(p_shop_id, p_customer_id);
end $$;

create or replace function public.reconcile_shop(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_bad jsonb;
  v_count int;
  v_walkin bigint;
begin
  perform app_private.require_role(p_shop_id, 'owner');
  select count(*), coalesce(jsonb_agg(r) filter (where not (r ->> 'ok')::boolean), '[]'::jsonb)
    into v_count, v_bad
  from (select app_private.reconcile_one(p_shop_id, c.id) as r from public.customers c where c.shop_id = p_shop_id) x;
  -- Walk-in entries have no customer and must net to zero (no anonymous credit).
  select coalesce(sum(l.amount_paise), 0) into v_walkin from public.ledger_entries l
  where l.shop_id = p_shop_id and l.customer_id is null;
  return jsonb_build_object('customers_checked', v_count, 'mismatches', v_bad, 'walkin_net_paise', v_walkin,
    'ok', jsonb_array_length(v_bad) = 0 and v_walkin = 0);
end $$;

-- Lets a client that lost its connection ask "did my request post?" using the original key.
create or replace function public.get_mutation_status(p_shop_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.client_mutations;
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  select * into v from public.client_mutations m
  where m.shop_id = p_shop_id and m.idempotency_key = p_idempotency_key and m.user_id = auth.uid();
  if not found or v.result is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'operation', v.operation, 'result', v.result, 'completed_at', v.completed_at);
end $$;
