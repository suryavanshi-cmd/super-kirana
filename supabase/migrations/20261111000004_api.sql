-- Application API: session context, customers, products, reads, reports, staff, platform admin,
-- and the service-role functions used by the `auth-admin` edge function.

-- ---------------------------------------------------------------- session context
create or replace function public.my_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_admin boolean;
  v_shops jsonb;
begin
  if v_uid is null then perform app_private.fail('NOT_AUTHENTICATED'); end if;
  select * into v_p from public.profiles p where p.user_id = v_uid;
  if not found then perform app_private.fail('PROFILE_MISSING'); end if;
  v_admin := app_private.is_admin(v_uid);
  if v_p.must_change_password then
    v_shops := '[]'::jsonb;
  elsif v_admin then
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'shop_username', s.shop_username, 'name_mr', s.name_mr,
        'name_en', s.name_en, 'status', s.status, 'timezone', s.timezone, 'role', 'owner',
        'is_member', exists (select 1 from public.shop_members m where m.shop_id = s.id and m.user_id = v_uid
                             and m.membership_status = 'active')) order by s.created_at), '[]'::jsonb)
      into v_shops from public.shops s;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'shop_username', s.shop_username, 'name_mr', s.name_mr,
        'name_en', s.name_en, 'status', s.status, 'timezone', s.timezone, 'role', m.role, 'is_member', true)
        order by s.created_at), '[]'::jsonb)
      into v_shops
    from public.shop_members m join public.shops s on s.id = m.shop_id
    where m.user_id = v_uid and m.membership_status = 'active' and s.status = 'active';
  end if;
  return jsonb_build_object('user_id', v_uid, 'username', v_p.login_username, 'display_name', v_p.display_name,
    'preferred_language', v_p.preferred_language, 'must_change_password', v_p.must_change_password,
    'is_platform_admin', v_admin, 'shops', v_shops);
end $$;

create or replace function public.set_preferred_language(p_language text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app_private.fail('NOT_AUTHENTICATED'); end if;
  if p_language not in ('mr-IN','en-IN') then perform app_private.fail('INVALID_LANGUAGE'); end if;
  update public.profiles p set preferred_language = p_language where p.user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------- customers
create or replace function public.list_customers(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'mobile', c.mobile, 'is_active', c.is_active,
      'balance_paise', coalesce(b.balance_paise, 0)) order by lower(c.name), c.created_at)
    from public.customers c left join public.customer_balances b on b.customer_id = c.id
    where c.shop_id = p_shop_id), '[]'::jsonb);
end $$;

create or replace function public.save_customer(p_shop_id uuid, p_customer jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_id uuid := nullif(p_customer ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_customer ->> 'name', ''));
  v_mobile text := nullif(btrim(coalesce(p_customer ->> 'mobile', '')), '');
  v_notes text := nullif(btrim(coalesce(p_customer ->> 'notes', '')), '');
  v_opening bigint := coalesce(app_private.jpaise(p_customer -> 'opening_balance_paise'), 0);
begin
  v_role := app_private.require_role(p_shop_id, 'cashier', true);
  if length(v_name) < 1 or length(v_name) > 120 then perform app_private.fail('NAME_REQUIRED'); end if;
  if v_mobile is not null and v_mobile !~ '^[0-9+][0-9 -]{5,14}$' then perform app_private.fail('INVALID_MOBILE'); end if;
  if length(coalesce(v_notes, '')) > 500 then perform app_private.fail('TEXT_TOO_LONG'); end if;
  if v_id is null then
    if v_opening > 0 and v_role <> 'owner' then
      perform app_private.fail('OWNER_ONLY', 'only the owner can enter an opening balance');
    end if;
    -- Client-generated ids make "add customer" safely retryable: a repeat returns the same row.
    v_id := coalesce(nullif(p_customer ->> 'new_id', '')::uuid, gen_random_uuid());
    if exists (select 1 from public.customers c where c.id = v_id) then
      if exists (select 1 from public.customers c where c.id = v_id and c.shop_id = p_shop_id) then
        return jsonb_build_object('id', v_id, 'created', false);
      end if;
      perform app_private.fail('FORBIDDEN');
    end if;
    insert into public.customers(id, shop_id, name, mobile, notes, created_by)
    values (v_id, p_shop_id, v_name, v_mobile, v_notes, v_uid);
    insert into public.customer_balances(customer_id, shop_id) values (v_id, p_shop_id);
    if v_opening > 0 then
      insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, business_date, created_by, note)
      values (p_shop_id, v_id, 'opening_balance', v_opening, app_private.shop_today(p_shop_id), v_uid, 'opening balance');
    end if;
    perform app_private.audit(p_shop_id, v_uid, 'customer.created', 'customer', v_id::text,
      jsonb_build_object('opening_balance_paise', v_opening));
    return jsonb_build_object('id', v_id, 'created', true);
  end if;
  if v_role <> 'owner' then perform app_private.fail('OWNER_ONLY'); end if;
  update public.customers c set name = v_name, mobile = v_mobile, notes = v_notes,
    is_active = coalesce((p_customer ->> 'is_active')::boolean, c.is_active), updated_at = now()
  where c.id = v_id and c.shop_id = p_shop_id;
  if not found then perform app_private.fail('CUSTOMER_NOT_FOUND'); end if;
  perform app_private.audit(p_shop_id, v_uid, 'customer.updated', 'customer', v_id::text, '{}'::jsonb);
  return jsonb_build_object('id', v_id, 'created', false);
end $$;

create or replace function public.get_customer(p_shop_id uuid, p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  select * into c from public.customers x where x.id = p_customer_id and x.shop_id = p_shop_id;
  if not found then perform app_private.fail('CUSTOMER_NOT_FOUND'); end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'mobile', c.mobile, 'notes', c.notes, 'is_active', c.is_active, 'created_at', c.created_at,
    'opening_balance_paise', coalesce((select sum(l.amount_paise) from public.ledger_entries l
        where l.customer_id = c.id and l.entry_type = 'opening_balance'), 0),
    'purchases_paise', coalesce((select sum(i.total_paise) from public.invoices i
        where i.customer_id = c.id and i.status = 'posted'), 0),
    'payments_paise', coalesce((select sum(p.amount_paise) from public.payments p
        where p.customer_id = c.id and p.status = 'posted'), 0),
    'credits_paise', coalesce((select sum(n.amount_paise) from public.credit_notes n
        where n.customer_id = c.id and n.status = 'posted'), 0),
    'balance_paise', app_private.balance_of(c.id),
    'reconciled', (app_private.reconcile_one(p_shop_id, c.id) ->> 'ok')::boolean,
    'opening_outstanding_paise', app_private.opening_outstanding(c.id),
    'unpaid_invoices', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'invoice_no', u.invoice_no, 'posted_at', u.posted_at,
        'total_paise', u.total_paise, 'outstanding_paise', u.outstanding) order by u.posted_at, u.invoice_no)
      from (select i.id, i.invoice_no, i.posted_at, i.total_paise, app_private.invoice_outstanding(i.id) as outstanding
            from public.invoices i where i.customer_id = c.id and i.status = 'posted') u
      where u.outstanding > 0), '[]'::jsonb));
end $$;

-- Statement / transaction history with a running balance. Dates are shop business dates.
create or replace function public.get_customer_ledger(p_shop_id uuid, p_customer_id uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
  v_before bigint;
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.shop_id = p_shop_id) then
    perform app_private.fail('CUSTOMER_NOT_FOUND');
  end if;
  select coalesce(sum(l.amount_paise), 0) into v_before from public.ledger_entries l
  where l.shop_id = p_shop_id and l.customer_id = p_customer_id and p_from is not null and l.business_date < p_from;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.seq), '[]'::jsonb) into v_rows
  from (
    select l.id, l.entry_type, l.amount_paise, l.business_date, l.posted_at, l.note,
      l.invoice_id, l.payment_id, l.credit_note_id,
      i.invoice_no, p.payment_no, p.method, p.kind as payment_kind, p.reference,
      l.seq,
      sum(l.amount_paise) over (order by l.seq rows between unbounded preceding and current row) as running_paise,
      case when l.payment_id is not null and l.entry_type = 'payment' then (
        select jsonb_agg(jsonb_build_object('target', a.target, 'invoice_no', ai.invoice_no, 'amount_paise', a.amount_paise)
                         order by a.seq)
        from public.payment_allocations a left join public.invoices ai on ai.id = a.invoice_id
        where a.payment_id = l.payment_id) end as allocations
    from public.ledger_entries l
    left join public.invoices i on i.id = l.invoice_id
    left join public.payments p on p.id = l.payment_id
    where l.shop_id = p_shop_id and l.customer_id = p_customer_id
  ) e
  where (p_from is null or e.business_date >= p_from) and (p_to is null or e.business_date <= p_to);
  return jsonb_build_object('customer_id', p_customer_id, 'from', p_from, 'to', p_to,
    'balance_before_paise', v_before, 'entries', v_rows,
    'balance_paise', app_private.balance_of(p_customer_id));
end $$;

-- ---------------------------------------------------------------- products
create or replace function public.list_products(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_en', p.name_en, 'name_mr', p.name_mr,
      'unit', p.unit, 'default_price_paise', p.default_price_paise, 'is_active', p.is_active, 'barcode', p.barcode,
      'category', p.category, 'purchase_cost_paise', p.purchase_cost_paise, 'stock_qty', p.stock_qty, 'sku', p.sku)
      order by lower(p.name), p.created_at)
    from public.products p where p.shop_id = p_shop_id), '[]'::jsonb);
end $$;

-- Changing a product never touches invoice_items: bills keep the name, unit and price they were sold at.
create or replace function public.save_product(p_shop_id uuid, p_product jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p_product ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_product ->> 'name', ''));
  v_unit text := p_product ->> 'unit';
  v_price bigint := app_private.jpaise(p_product -> 'default_price_paise');
  v_cost bigint := app_private.jpaise(p_product -> 'purchase_cost_paise');
  v_stock numeric := nullif(p_product ->> 'stock_qty', '')::numeric;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if length(v_name) < 1 or length(v_name) > 120 then perform app_private.fail('NAME_REQUIRED'); end if;
  if v_unit is null or v_unit not in ('kg','g','litre','ml','packet','piece','dozen') then perform app_private.fail('INVALID_UNIT'); end if;
  if v_price is null or v_price > 1000000000 then perform app_private.fail('PRICE_REQUIRED'); end if;
  begin
    if v_id is null then
      v_id := coalesce(nullif(p_product ->> 'new_id', '')::uuid, gen_random_uuid());
      insert into public.products(id, shop_id, name, name_en, name_mr, unit, default_price_paise, barcode, category,
                                  purchase_cost_paise, stock_qty, sku, created_by)
      values (v_id, p_shop_id, v_name, nullif(btrim(coalesce(p_product ->> 'name_en', '')), ''),
              nullif(btrim(coalesce(p_product ->> 'name_mr', '')), ''), v_unit, v_price,
              nullif(btrim(coalesce(p_product ->> 'barcode', '')), ''), nullif(btrim(coalesce(p_product ->> 'category', '')), ''),
              v_cost, v_stock, nullif(btrim(coalesce(p_product ->> 'sku', '')), ''), v_uid);
      perform app_private.audit(p_shop_id, v_uid, 'product.created', 'product', v_id::text, '{}'::jsonb);
    else
      update public.products p set name = v_name,
        name_en = nullif(btrim(coalesce(p_product ->> 'name_en', '')), ''),
        name_mr = nullif(btrim(coalesce(p_product ->> 'name_mr', '')), ''),
        unit = v_unit, default_price_paise = v_price,
        barcode = nullif(btrim(coalesce(p_product ->> 'barcode', '')), ''),
        category = nullif(btrim(coalesce(p_product ->> 'category', '')), ''),
        purchase_cost_paise = v_cost, stock_qty = v_stock,
        sku = nullif(btrim(coalesce(p_product ->> 'sku', '')), ''),
        is_active = coalesce((p_product ->> 'is_active')::boolean, p.is_active), updated_at = now()
      where p.id = v_id and p.shop_id = p_shop_id;
      if not found then perform app_private.fail('PRODUCT_NOT_FOUND'); end if;
      perform app_private.audit(p_shop_id, v_uid, 'product.updated', 'product', v_id::text,
        jsonb_build_object('default_price_paise', v_price));
    end if;
  exception when unique_violation then
    perform app_private.fail('DUPLICATE_CODE', 'another product already uses this SKU or barcode');
  end;
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------- documents (receipts)
create or replace function public.get_invoice(p_shop_id uuid, p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  i public.invoices;
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  select * into i from public.invoices x where x.id = p_invoice_id and x.shop_id = p_shop_id;
  if not found then perform app_private.fail('INVOICE_NOT_FOUND'); end if;
  return jsonb_build_object(
    'id', i.id, 'invoice_no', i.invoice_no, 'status', i.status, 'customer_id', i.customer_id, 'customer_name', i.customer_name,
    'subtotal_paise', i.subtotal_paise, 'discount_paise', i.discount_paise, 'total_paise', i.total_paise,
    'paid_at_posting_paise', i.paid_at_posting_paise, 'old_dues_paid_paise', i.old_dues_paid_paise,
    'bill_due_at_posting_paise', i.total_paise - i.paid_at_posting_paise,
    'previous_balance_paise', i.previous_balance_paise, 'balance_after_paise', i.balance_after_paise,
    'outstanding_paise', app_private.invoice_outstanding(i.id),
    'source', i.source, 'note', i.note, 'business_date', i.business_date, 'posted_at', i.posted_at,
    'created_by_name', (select p.display_name from public.profiles p where p.user_id = i.created_by),
    'reversed_at', i.reversed_at, 'reversal_reason', i.reversal_reason,
    'shop', (select jsonb_build_object('name_mr', s.name_mr, 'name_en', s.name_en, 'timezone', s.timezone)
             from public.shops s where s.id = i.shop_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('line_no', t.line_no, 'name', t.name, 'qty', t.qty, 'unit', t.unit,
        'price_unit', t.price_unit, 'unit_price_paise', t.unit_price_paise, 'gross_paise', t.gross_paise,
        'discount_paise', t.discount_paise, 'line_total_paise', t.line_total_paise) order by t.line_no), '[]'::jsonb)
      from public.invoice_items t where t.invoice_id = i.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'payment_no', p.payment_no, 'kind', p.kind,
        'amount_paise', p.amount_paise, 'method', p.method, 'reference', p.reference, 'status', p.status)
        order by p.payment_no), '[]'::jsonb)
      from public.payments p
      where p.shop_id = i.shop_id and (p.invoice_id = i.id or p.id in
        (select a.payment_id from public.payment_allocations a where a.invoice_id = i.id and a.payment_id is not null))));
end $$;

create or replace function public.get_payment(p_shop_id uuid, p_payment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.payments;
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  select * into p from public.payments x where x.id = p_payment_id and x.shop_id = p_shop_id;
  if not found then perform app_private.fail('PAYMENT_NOT_FOUND'); end if;
  return jsonb_build_object(
    'id', p.id, 'payment_no', p.payment_no, 'kind', p.kind, 'status', p.status, 'customer_id', p.customer_id,
    'customer_name', (select c.name from public.customers c where c.id = p.customer_id),
    'invoice_id', p.invoice_id, 'amount_paise', p.amount_paise, 'method', p.method, 'reference', p.reference, 'note', p.note,
    'previous_balance_paise', p.previous_balance_paise, 'balance_after_paise', p.balance_after_paise,
    'business_date', p.business_date, 'posted_at', p.posted_at,
    'created_by_name', (select q.display_name from public.profiles q where q.user_id = p.created_by),
    'reversed_at', p.reversed_at, 'reversal_reason', p.reversal_reason,
    'shop', (select jsonb_build_object('name_mr', s.name_mr, 'name_en', s.name_en, 'timezone', s.timezone)
             from public.shops s where s.id = p.shop_id),
    'allocations', (select coalesce(jsonb_agg(jsonb_build_object('target', a.target, 'invoice_no', i.invoice_no,
        'amount_paise', a.amount_paise) order by a.seq), '[]'::jsonb)
      from public.payment_allocations a left join public.invoices i on i.id = a.invoice_id where a.payment_id = p.id));
end $$;

create or replace function public.list_recent_activity(p_shop_id uuid, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  return coalesce((
    select jsonb_agg(to_jsonb(e) order by e.seq desc)
    from (
      select l.id, l.seq, l.entry_type, l.amount_paise, l.posted_at, l.customer_id, l.invoice_id, l.payment_id, l.credit_note_id,
        coalesce(c.name, i.customer_name) as customer_name, i.invoice_no, p.payment_no, p.method
      from public.ledger_entries l
      left join public.customers c on c.id = l.customer_id
      left join public.invoices i on i.id = l.invoice_id
      left join public.payments p on p.id = l.payment_id
      where l.shop_id = p_shop_id
      order by l.seq desc
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) e), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- reports
-- REPORT CUT-OFF: a "day" is the shop's local calendar day (shops.timezone, Asia/Kolkata by
-- default), fixed on each ledger entry as business_date when it is posted.
--   sales        = bills posted that day, minus bills reversed and returns/credits posted that day
--   collections  = payments posted that day (bill payments + old-dues collections), minus reversals
--   Collecting old dues never changes sales. Outstanding credit is a balance, not revenue.
create or replace function app_private.day_summary(p_shop uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with l as (
    select le.entry_type, le.amount_paise, pm.method
    from public.ledger_entries le left join public.payments pm on pm.id = le.payment_id
    where le.shop_id = p_shop and le.business_date between p_from and p_to
  ), t as (
    select
      coalesce(sum(amount_paise) filter (where entry_type = 'invoice'), 0)::bigint as sales_gross,
      coalesce(-sum(amount_paise) filter (where entry_type = 'invoice_reversal'), 0)::bigint as sales_reversed,
      coalesce(-sum(amount_paise) filter (where entry_type in ('credit','credit_reversal')), 0)::bigint as credits,
      coalesce(-sum(amount_paise) filter (where entry_type = 'payment'), 0)::bigint as coll_gross,
      coalesce(sum(amount_paise) filter (where entry_type = 'payment_reversal'), 0)::bigint as coll_reversed,
      coalesce(-sum(amount_paise) filter (where entry_type in ('payment','payment_reversal') and method = 'cash'), 0)::bigint as cash,
      coalesce(-sum(amount_paise) filter (where entry_type in ('payment','payment_reversal') and method = 'upi'), 0)::bigint as upi,
      coalesce(-sum(amount_paise) filter (where entry_type in ('payment','payment_reversal') and method = 'other'), 0)::bigint as other,
      count(*) filter (where entry_type = 'invoice') as bills
    from l
  )
  select jsonb_build_object(
    'sales_gross_paise', sales_gross, 'sales_reversed_paise', sales_reversed, 'credits_paise', credits,
    'net_sales_paise', sales_gross - sales_reversed - credits,
    'collections_gross_paise', coll_gross, 'collections_reversed_paise', coll_reversed,
    'net_collections_paise', coll_gross - coll_reversed,
    'cash_paise', cash, 'upi_paise', upi, 'other_paise', other, 'bills', bills)
  from t;
$$;

create or replace function public.get_shop_daily_summary(p_shop_id uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text;
  v_today date;
  v_date date;
begin
  v_role := app_private.require_role(p_shop_id, 'cashier');
  v_today := app_private.shop_today(p_shop_id);
  v_date := coalesce(p_date, v_today);
  if v_role <> 'owner' and v_date <> v_today then perform app_private.fail('OWNER_ONLY'); end if;
  return app_private.day_summary(p_shop_id, v_date, v_date) || jsonb_build_object(
    'date', v_date,
    'total_outstanding_paise', coalesce((select sum(b.balance_paise) from public.customer_balances b where b.shop_id = p_shop_id), 0),
    'customers_with_due', (select count(*) from public.customer_balances b where b.shop_id = p_shop_id and b.balance_paise > 0));
end $$;

create or replace function public.get_report(p_shop_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'owner');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then perform app_private.fail('INVALID_RANGE'); end if;
  return jsonb_build_object('from', p_from, 'to', p_to,
    'totals', app_private.day_summary(p_shop_id, p_from, p_to),
    'days', coalesce((select jsonb_agg(app_private.day_summary(p_shop_id, d.d, d.d) || jsonb_build_object('date', d.d) order by d.d)
      from (select distinct le.business_date as d from public.ledger_entries le
            where le.shop_id = p_shop_id and le.business_date between p_from and p_to) d), '[]'::jsonb),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'business_date', i.business_date,
        'posted_at', i.posted_at, 'customer_name', i.customer_name, 'total_paise', i.total_paise,
        'paid_at_posting_paise', i.paid_at_posting_paise, 'status', i.status,
        'outstanding_paise', app_private.invoice_outstanding(i.id)) order by i.invoice_no desc)
      from public.invoices i where i.shop_id = p_shop_id and i.business_date between p_from and p_to), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'payment_no', p.payment_no, 'business_date', p.business_date,
        'posted_at', p.posted_at, 'customer_name', c.name, 'kind', p.kind, 'method', p.method, 'amount_paise', p.amount_paise,
        'reference', p.reference, 'status', p.status) order by p.payment_no desc)
      from public.payments p left join public.customers c on c.id = p.customer_id
      where p.shop_id = p_shop_id and p.business_date between p_from and p_to), '[]'::jsonb));
end $$;

create or replace function public.get_outstanding_report(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'owner');
  return coalesce((
    select jsonb_agg(jsonb_build_object('customer_id', c.id, 'name', c.name, 'mobile', c.mobile, 'balance_paise', b.balance_paise,
      'oldest_unpaid_date', (select min(i.business_date) from public.invoices i
          where i.customer_id = c.id and i.status = 'posted' and app_private.invoice_outstanding(i.id) > 0))
      order by b.balance_paise desc, lower(c.name))
    from public.customer_balances b join public.customers c on c.id = b.customer_id
    where b.shop_id = p_shop_id and b.balance_paise > 0), '[]'::jsonb);
end $$;

create or replace function public.list_audit(p_shop_id uuid, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'owner');
  return coalesce((
    select jsonb_agg(to_jsonb(e) order by e.id desc)
    from (select a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
            (select p.display_name from public.profiles p where p.user_id = a.actor_id) as actor_name
          from public.audit_events a where a.shop_id = p_shop_id
          order by a.id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) e), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- OCR job log (text only; images are never stored)
create or replace function public.log_ocr_job(p_shop_id uuid, p_provider text, p_status text, p_raw_text text, p_items jsonb, p_mean_confidence numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_role(p_shop_id, 'cashier', true);
  if p_status not in ('recognized','low_confidence','failed') then perform app_private.fail('INVALID_STATUS'); end if;
  -- Retention: OCR text is kept for 30 days, then removed.
  delete from public.ocr_jobs o where o.shop_id = p_shop_id and o.created_at < now() - interval '30 days'
    and not exists (select 1 from public.invoices i where i.ocr_job_id = o.id);
  insert into public.ocr_jobs(shop_id, created_by, provider, status, raw_text, items, mean_confidence)
  values (p_shop_id, auth.uid(), left(coalesce(p_provider, 'unknown'), 40), p_status, left(p_raw_text, 20000),
          coalesce(p_items, '[]'::jsonb), p_mean_confidence)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- staff
create or replace function app_private.revoke_sessions(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  begin
    delete from auth.sessions s where s.user_id = p_user;
  exception when others then
    null;  -- access is already blocked by the live membership checks; this only shortens token refresh
  end;
end $$;

create or replace function public.list_members(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'owner');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', p.login_username, 'display_name', p.display_name,
      'role', m.role, 'status', m.membership_status, 'must_change_password', p.must_change_password)
      order by m.role desc, lower(p.display_name))
    from public.shop_members m join public.profiles p on p.user_id = m.user_id where m.shop_id = p_shop_id), '[]'::jsonb);
end $$;

-- Owners manage cashiers. Only a platform admin can change owners. The last active owner of a
-- shop can never be disabled or demoted.
create or replace function public.set_member(p_shop_id uuid, p_user_id uuid, p_role text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := app_private.is_admin(auth.uid());
  m public.shop_members;
begin
  perform app_private.require_role(p_shop_id, 'owner');
  if p_role not in ('owner','cashier') or p_status not in ('active','disabled') then perform app_private.fail('INVALID_INPUT'); end if;
  select * into m from public.shop_members x where x.shop_id = p_shop_id and x.user_id = p_user_id for update;
  if not found then perform app_private.fail('MEMBER_NOT_FOUND'); end if;
  if not v_admin and (m.role = 'owner' or p_role = 'owner' or p_user_id = v_uid) then
    perform app_private.fail('ADMIN_ONLY', 'only the platform admin can change owners');
  end if;
  if m.role = 'owner' and m.membership_status = 'active' and (p_role <> 'owner' or p_status <> 'active')
     and not exists (select 1 from public.shop_members o where o.shop_id = p_shop_id and o.user_id <> p_user_id
                     and o.role = 'owner' and o.membership_status = 'active') then
    perform app_private.fail('LAST_OWNER', 'a shop must keep at least one active owner');
  end if;
  update public.shop_members x set role = p_role, membership_status = p_status, updated_at = now()
  where x.shop_id = p_shop_id and x.user_id = p_user_id;
  if p_status = 'disabled' then perform app_private.revoke_sessions(p_user_id); end if;
  perform app_private.audit(p_shop_id, v_uid, 'member.updated', 'user', p_user_id::text,
    jsonb_build_object('role', p_role, 'status', p_status, 'previous_role', m.role, 'previous_status', m.membership_status));
  return jsonb_build_object('user_id', p_user_id, 'role', p_role, 'status', p_status);
end $$;

create or replace function public.update_shop(p_shop_id uuid, p_name_mr text, p_name_en text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'owner');
  if length(btrim(coalesce(p_name_mr, ''))) < 1 or length(btrim(coalesce(p_name_en, ''))) < 1
     or length(p_name_mr) > 120 or length(p_name_en) > 120 then perform app_private.fail('NAME_REQUIRED'); end if;
  update public.shops s set name_mr = btrim(p_name_mr), name_en = btrim(p_name_en) where s.id = p_shop_id;
  perform app_private.audit(p_shop_id, auth.uid(), 'shop.updated', 'shop', p_shop_id::text,
    jsonb_build_object('name_mr', btrim(p_name_mr), 'name_en', btrim(p_name_en)));
end $$;

-- ---------------------------------------------------------------- platform admin
create or replace function app_private.require_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then perform app_private.fail('NOT_AUTHENTICATED'); end if;
  if not app_private.is_admin(v_uid)
     or exists (select 1 from public.profiles p where p.user_id = v_uid and p.must_change_password) then
    perform app_private.fail('ADMIN_ONLY');
  end if;
  return v_uid;
end $$;

-- Per-shop rows only; money is never combined across shops.
create or replace function public.admin_list_shops()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'shop_username', s.shop_username, 'name_mr', s.name_mr, 'name_en', s.name_en,
      'status', s.status, 'created_at', s.created_at,
      'members', (select count(*) from public.shop_members m where m.shop_id = s.id and m.membership_status = 'active'),
      'customers', (select count(*) from public.customers c where c.shop_id = s.id),
      'bills', s.invoice_seq) order by s.created_at)
    from public.shops s), '[]'::jsonb);
end $$;

create or replace function public.admin_set_shop_status(p_shop_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_admin();
begin
  if p_status not in ('active','suspended') then perform app_private.fail('INVALID_INPUT'); end if;
  update public.shops s set status = p_status where s.id = p_shop_id;
  if not found then perform app_private.fail('SHOP_NOT_FOUND'); end if;
  perform app_private.audit(p_shop_id, v_uid, 'shop.status', 'shop', p_shop_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_list_audit(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(e) order by e.id desc)
    from (select a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
            (select s.name_en from public.shops s where s.id = a.shop_id) as shop_name,
            (select p.display_name from public.profiles p where p.user_id = a.actor_id) as actor_name
          from public.audit_events a
          where a.action like 'auth.%' or a.action like 'shop.%' or a.action like 'member.%' or a.action like 'platform.%'
          order by a.id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) e), '[]'::jsonb);
end $$;

-- ================================================================ service-role functions
-- Called only by the auth-admin edge function (service role). They take the acting user id
-- explicitly because a service-role connection has no auth.uid().

-- Fixed-window rate limiter. Returns true when the attempt is allowed.
create or replace function public.svc_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_attempts int;
begin
  insert into public.auth_throttle as t(key, window_start, attempts) values (p_key, now(), 1)
  on conflict (key) do update set
    attempts = case when t.window_start < now() - make_interval(secs => p_window_seconds) then 1 else t.attempts + 1 end,
    window_start = case when t.window_start < now() - make_interval(secs => p_window_seconds) then now() else t.window_start end
  returning t.attempts into v_attempts;
  delete from public.auth_throttle t where t.window_start < now() - interval '1 day';
  return v_attempts <= p_max;
end $$;

create or replace function public.svc_resolve_login(p_username text)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.user_id from public.profiles p where p.login_username = lower(btrim(p_username));
$$;

create or replace function public.svc_username_of(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select p.login_username from public.profiles p where p.user_id = p_user_id;
$$;

create or replace function public.svc_needs_setup()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.platform_admins);
$$;

create or replace function public.svc_log_auth(p_user uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  select app_private.audit(null, p_user, p_action, 'user', p_user::text, p_details);
$$;

create or replace function app_private.check_username(p_username text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  u text := lower(btrim(coalesce(p_username, '')));
begin
  if u !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then perform app_private.fail('INVALID_USERNAME'); end if;
  if exists (select 1 from public.profiles p where p.login_username = u) then perform app_private.fail('USERNAME_TAKEN'); end if;
  return u;
end $$;

-- First-run setup: valid only with the one-time setup code, and only while no admin exists.
create or replace function public.svc_check_setup(p_code text, p_username text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.platform_admins) then perform app_private.fail('SETUP_DONE'); end if;
  if not exists (select 1 from public.platform_setup s where s.id = 1 and s.used_at is null and s.expires_at > now()
                 and s.code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')) then
    perform app_private.fail('INVALID_SETUP_CODE');
  end if;
  perform app_private.check_username(p_username);
end $$;

create or replace function public.svc_complete_setup(p_code text, p_user_id uuid, p_username text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
  u text;
begin
  perform 1 from public.platform_setup s where s.id = 1 for update;
  perform public.svc_check_setup(p_code, p_username);
  u := lower(btrim(p_username));
  insert into public.profiles(user_id, login_username, display_name) values (p_user_id, u, btrim(p_display_name));
  insert into public.platform_admins(user_id) values (p_user_id);
  insert into public.shops(shop_username, name_mr, name_en, created_by)
  values ('superkirana-niphad', 'सुपर किराणा, निफाड', 'Super Kirana, Niphad', p_user_id)
  on conflict (shop_username) do nothing;
  select s.id into v_shop from public.shops s where s.shop_username = 'superkirana-niphad';
  insert into public.shop_members(shop_id, user_id, role) values (v_shop, p_user_id, 'owner')
  on conflict (shop_id, user_id) do nothing;
  update public.platform_setup s set used_at = now(), used_by = p_user_id where s.id = 1;
  perform app_private.audit(v_shop, p_user_id, 'platform.setup', 'user', p_user_id::text, jsonb_build_object('username', u));
  return jsonb_build_object('shop_id', v_shop);
end $$;

create or replace function app_private.actor_is_admin(p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.is_admin(p_actor)
     and not exists (select 1 from public.profiles p where p.user_id = p_actor and p.must_change_password);
$$;

create or replace function app_private.actor_is_owner(p_actor uuid, p_shop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shop_members m join public.shops s on s.id = m.shop_id
                 join public.profiles p on p.user_id = m.user_id
                 where m.shop_id = p_shop and m.user_id = p_actor and m.role = 'owner'
                   and m.membership_status = 'active' and s.status = 'active' and not p.must_change_password);
$$;

-- Validates a "create shop" request before any identity is created. Returns the existing shop id
-- when the same request id was already completed (repeat submissions never create duplicates).
create or replace function public.svc_precheck_create_shop(
  p_actor uuid, p_request_id uuid, p_shop_username text, p_name_mr text, p_name_en text, p_owner_username text, p_owner_is_new boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing uuid;
  su text := lower(btrim(coalesce(p_shop_username, '')));
begin
  if not app_private.actor_is_admin(p_actor) then perform app_private.fail('ADMIN_ONLY'); end if;
  select s.id into v_existing from public.shops s where s.onboarding_request_id = p_request_id;
  if v_existing is not null then return jsonb_build_object('existing_shop_id', v_existing); end if;
  if su !~ '^[a-z0-9][a-z0-9_-]{2,39}$' then perform app_private.fail('INVALID_SHOP_USERNAME'); end if;
  if exists (select 1 from public.shops s where s.shop_username = su) then perform app_private.fail('SHOP_USERNAME_TAKEN'); end if;
  if length(btrim(coalesce(p_name_mr, ''))) < 1 or length(btrim(coalesce(p_name_en, ''))) < 1 then perform app_private.fail('NAME_REQUIRED'); end if;
  if p_owner_is_new then
    perform app_private.check_username(p_owner_username);
    return jsonb_build_object('existing_shop_id', null, 'owner_user_id', null);
  end if;
  if public.svc_resolve_login(p_owner_username) is null then perform app_private.fail('USER_NOT_FOUND'); end if;
  return jsonb_build_object('existing_shop_id', null, 'owner_user_id', public.svc_resolve_login(p_owner_username));
end $$;

create or replace function public.svc_create_shop(
  p_actor uuid, p_request_id uuid, p_shop_username text, p_name_mr text, p_name_en text,
  p_owner_user_id uuid, p_owner_username text, p_owner_display_name text, p_owner_is_new boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  if not app_private.actor_is_admin(p_actor) then perform app_private.fail('ADMIN_ONLY'); end if;
  if p_owner_is_new then
    insert into public.profiles(user_id, login_username, display_name, must_change_password)
    values (p_owner_user_id, lower(btrim(p_owner_username)), btrim(p_owner_display_name), true);
  end if;
  insert into public.shops(shop_username, name_mr, name_en, onboarding_request_id, created_by)
  values (lower(btrim(p_shop_username)), btrim(p_name_mr), btrim(p_name_en), p_request_id, p_actor)
  returning id into v_shop;
  insert into public.shop_members(shop_id, user_id, role) values (v_shop, p_owner_user_id, 'owner');
  perform app_private.audit(v_shop, p_actor, 'shop.created', 'shop', v_shop::text,
    jsonb_build_object('shop_username', lower(btrim(p_shop_username)), 'owner_user_id', p_owner_user_id));
  return jsonb_build_object('shop_id', v_shop);
end $$;

-- Adding staff: a platform admin can add owners or cashiers to any shop; a shop owner can add
-- cashiers to their own shop.
create or replace function public.svc_precheck_add_member(p_actor uuid, p_shop_id uuid, p_username text, p_role text, p_is_new boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if p_role not in ('owner','cashier') then perform app_private.fail('INVALID_INPUT'); end if;
  if not exists (select 1 from public.shops s where s.id = p_shop_id) then perform app_private.fail('SHOP_NOT_FOUND'); end if;
  if not app_private.actor_is_admin(p_actor) then
    if not app_private.actor_is_owner(p_actor, p_shop_id) then perform app_private.fail('FORBIDDEN'); end if;
    if p_role <> 'cashier' or not p_is_new then
      perform app_private.fail('ADMIN_ONLY', 'owners can only create new cashier accounts');
    end if;
  end if;
  if p_is_new then
    perform app_private.check_username(p_username);
    return jsonb_build_object('user_id', null);
  end if;
  v_user := public.svc_resolve_login(p_username);
  if v_user is null then perform app_private.fail('USER_NOT_FOUND'); end if;
  if exists (select 1 from public.shop_members m where m.shop_id = p_shop_id and m.user_id = v_user) then
    perform app_private.fail('ALREADY_MEMBER');
  end if;
  return jsonb_build_object('user_id', v_user);
end $$;

create or replace function public.svc_add_member(p_actor uuid, p_shop_id uuid, p_user_id uuid, p_username text, p_display_name text, p_role text, p_is_new boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.svc_precheck_add_member(p_actor, p_shop_id, p_username, p_role, p_is_new);
  if p_is_new then
    insert into public.profiles(user_id, login_username, display_name, must_change_password)
    values (p_user_id, lower(btrim(p_username)), btrim(p_display_name), true);
  end if;
  insert into public.shop_members(shop_id, user_id, role) values (p_shop_id, p_user_id, p_role);
  perform app_private.audit(p_shop_id, p_actor, 'member.added', 'user', p_user_id::text,
    jsonb_build_object('role', p_role, 'username', lower(btrim(p_username)), 'new_account', p_is_new));
  return jsonb_build_object('user_id', p_user_id);
end $$;

-- Admin-controlled recovery. An admin can reset anyone; an owner can reset only accounts that are
-- cashiers in their shop and hold no owner/admin role anywhere. The person must choose a new
-- password at next login (must_change_password), and their sessions are revoked.
create or replace function public.svc_begin_password_reset(p_actor uuid, p_shop_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id) then perform app_private.fail('USER_NOT_FOUND'); end if;
  if not app_private.actor_is_admin(p_actor) then
    if p_shop_id is null or not app_private.actor_is_owner(p_actor, p_shop_id)
       or not exists (select 1 from public.shop_members m where m.shop_id = p_shop_id and m.user_id = p_user_id and m.role = 'cashier')
       or exists (select 1 from public.shop_members m where m.user_id = p_user_id and m.role = 'owner')
       or app_private.is_admin(p_user_id) then
      perform app_private.fail('FORBIDDEN');
    end if;
  end if;
  update public.profiles p set must_change_password = true where p.user_id = p_user_id;
  perform app_private.revoke_sessions(p_user_id);
  perform app_private.audit(p_shop_id, p_actor, 'auth.password_reset', 'user', p_user_id::text, '{}'::jsonb);
end $$;

create or replace function public.svc_password_changed(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set must_change_password = false where p.user_id = p_user_id;
  perform app_private.audit(null, p_user_id, 'auth.password_changed', 'user', p_user_id::text, '{}'::jsonb);
end $$;

-- ================================================================ grants
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.has_shop_access(uuid), app_private.shop_role(uuid) to authenticated;

grant execute on function
  public.my_context(), public.set_preferred_language(text),
  public.list_customers(uuid), public.save_customer(uuid, jsonb), public.get_customer(uuid, uuid),
  public.get_customer_ledger(uuid, uuid, date, date), public.get_customer_balance(uuid, uuid),
  public.list_products(uuid), public.save_product(uuid, jsonb),
  public.create_invoice(uuid, uuid, uuid, jsonb, bigint, text, text, text, text, uuid),
  public.receive_payment(uuid, uuid, uuid, bigint, text, text, text),
  public.reverse_payment(uuid, uuid, uuid, text), public.reverse_invoice(uuid, uuid, uuid, text),
  public.issue_credit_or_return(uuid, uuid, uuid, bigint, text, text, uuid), public.reverse_credit(uuid, uuid, uuid, text),
  public.set_opening_balance(uuid, uuid, uuid, bigint, text),
  public.reconcile_customer_ledger(uuid, uuid), public.reconcile_shop(uuid), public.get_mutation_status(uuid, uuid),
  public.get_invoice(uuid, uuid), public.get_payment(uuid, uuid), public.list_recent_activity(uuid, int),
  public.get_shop_daily_summary(uuid, date), public.get_report(uuid, date, date), public.get_outstanding_report(uuid),
  public.list_audit(uuid, int), public.log_ocr_job(uuid, text, text, text, jsonb, numeric),
  public.list_members(uuid), public.set_member(uuid, uuid, text, text), public.update_shop(uuid, text, text),
  public.admin_list_shops(), public.admin_set_shop_status(uuid, text), public.admin_list_audit(int)
to authenticated;

grant execute on function
  public.svc_rate_limit(text, int, int), public.svc_resolve_login(text), public.svc_log_auth(uuid, text, jsonb),
  public.svc_username_of(uuid), public.svc_needs_setup(),
  public.svc_check_setup(text, text), public.svc_complete_setup(text, uuid, text, text),
  public.svc_precheck_create_shop(uuid, uuid, text, text, text, text, boolean),
  public.svc_create_shop(uuid, uuid, text, text, text, uuid, text, text, boolean),
  public.svc_precheck_add_member(uuid, uuid, text, text, boolean),
  public.svc_add_member(uuid, uuid, uuid, text, text, text, boolean),
  public.svc_begin_password_reset(uuid, uuid, uuid), public.svc_password_changed(uuid)
to service_role;
