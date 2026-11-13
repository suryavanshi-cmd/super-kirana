-- Inventory (stock-in, stock counts, ready-made product list) and sales insights.
-- Strictly additive: no existing table, function or policy used by billing / khata is changed.
-- Stock is never written by bills: it is computed when read (stock added − quantity sold on posted
-- bills since tracking began), so a bill can never fail because of stock.

-- ---------------------------------------------------------------- products: two optional columns
alter table public.products add column if not exists catalog_ref text
  check (catalog_ref is null or catalog_ref ~ '^[a-z0-9-]{1,40}$');
alter table public.products add column if not exists reorder_level numeric(12,3)
  check (reorder_level is null or (reorder_level >= 0 and reorder_level <= 100000));
create unique index if not exists products_shop_catalog_uq on public.products(shop_id, catalog_ref) where catalog_ref is not null;
create index if not exists invoice_items_shop_product_idx on public.invoice_items(shop_id, product_id) where product_id is not null;

-- ---------------------------------------------------------------- stock entries (append-only)
create table if not exists public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  batch_id uuid not null,                         -- the idempotency key of the save that created it
  product_id uuid not null,
  kind text not null check (kind in ('purchase','count')),
  qty numeric(14,3) not null check (abs(qty) <= 1000000),   -- in the product's unit; for a count, the difference
  cost_paise bigint check (cost_paise is null or cost_paise between 0 and 100000000000),  -- total paid for this line
  supplier text check (supplier is null or length(supplier) <= 80),
  note text check (note is null or length(note) <= 300),
  business_date date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id),
  foreign key (shop_id, product_id) references public.products(shop_id, id),
  check (kind = 'count' or qty > 0)
);
create index if not exists stock_entries_product_idx on public.stock_entries(shop_id, product_id, created_at);
create index if not exists stock_entries_batch_idx on public.stock_entries(shop_id, batch_id);

alter table public.stock_entries enable row level security;
drop policy if exists stock_entries_select on public.stock_entries;
create policy stock_entries_select on public.stock_entries for select to authenticated
  using (app_private.shop_role(shop_id) = 'owner');
revoke all on public.stock_entries from anon, authenticated;
grant select on public.stock_entries to authenticated;

drop trigger if exists stock_entries_immutable on public.stock_entries;
create trigger stock_entries_immutable before update or delete on public.stock_entries
  for each row execute function app_private.deny_change();

-- ---------------------------------------------------------------- stock helpers
-- Current stock of one product in its own unit, or null when stock is not tracked for it yet.
create or replace function app_private.stock_of(p_shop uuid, p_product uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  with s as (
    select min(e.created_at) as since, sum(e.qty) as added
    from public.stock_entries e where e.shop_id = p_shop and e.product_id = p_product
  )
  select case when s.since is null then null else round(s.added - coalesce((
    select sum(ii.qty * r.num / r.den)
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id
    join public.products p on p.id = ii.product_id
    cross join lateral app_private.unit_ratio(ii.unit, p.unit) r
    where ii.shop_id = p_shop and ii.product_id = p_product and i.status = 'posted'
      and i.posted_at >= s.since and r.num is not null), 0), 3) end
  from s;
$$;

-- Quantity of a product sold (in its own unit) on posted bills between two business dates.
create or replace function app_private.sold_qty(p_shop uuid, p_product uuid, p_from date, p_to date)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(coalesce(sum(ii.qty * r.num / r.den), 0), 3)
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
  join public.products p on p.id = ii.product_id
  cross join lateral app_private.unit_ratio(ii.unit, p.unit) r
  where ii.shop_id = p_shop and ii.product_id = p_product and i.status = 'posted'
    and i.business_date between p_from and p_to and r.num is not null;
$$;

create or replace function app_private.clean_text(p text, p_max int)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g')), p_max), '');
$$;

-- ---------------------------------------------------------------- add products from the ready-made list
-- p_items: [{ref, name, name_mr?, name_en?, category?, unit, price_paise, reorder_level?}] (max 300).
-- A product already added from the same list entry is skipped, so pressing "add" twice is harmless.
create or replace function public.add_catalog_products(p_shop_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_ref text; v_name text; v_unit text; v_price bigint; v_level numeric;
  v_added int := 0; v_skipped int := 0; v_ids jsonb := '{}'::jsonb; v_id uuid;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then perform app_private.fail('NO_ITEMS'); end if;
  if jsonb_array_length(p_items) > 300 then perform app_private.fail('TOO_MANY_ITEMS'); end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_ref := v_item ->> 'ref';
    if v_ref is null or v_ref !~ '^[a-z0-9-]{1,40}$' then perform app_private.fail('INVALID_ITEM'); end if;
    v_name := app_private.clean_text(v_item ->> 'name', 120);
    if v_name is null then perform app_private.fail('NAME_REQUIRED'); end if;
    v_unit := v_item ->> 'unit';
    if v_unit is null or v_unit not in ('kg','g','litre','ml','packet','piece','dozen') then perform app_private.fail('INVALID_UNIT'); end if;
    v_price := app_private.jpaise(v_item -> 'price_paise');
    if v_price is null or v_price > 1000000000 then perform app_private.fail('PRICE_REQUIRED'); end if;
    v_level := case when nullif(v_item ->> 'reorder_level', '') is null then null else app_private.jqty(v_item -> 'reorder_level') end;
    select p.id into v_id from public.products p where p.shop_id = p_shop_id and p.catalog_ref = v_ref;
    if found then
      v_skipped := v_skipped + 1;
    else
      v_id := gen_random_uuid();
      insert into public.products(id, shop_id, name, name_en, name_mr, unit, default_price_paise, category, catalog_ref, reorder_level, created_by)
      values (v_id, p_shop_id, v_name, app_private.clean_text(v_item ->> 'name_en', 120), app_private.clean_text(v_item ->> 'name_mr', 120),
              v_unit, v_price, app_private.clean_text(v_item ->> 'category', 60), v_ref, v_level, v_uid);
      v_added := v_added + 1;
    end if;
    v_ids := v_ids || jsonb_build_object(v_ref, v_id);
  end loop;
  perform app_private.audit(p_shop_id, v_uid, 'product.catalog_added', 'product', null,
    jsonb_build_object('added', v_added, 'skipped', v_skipped));
  return jsonb_build_object('added', v_added, 'skipped', v_skipped, 'ids', v_ids);
end $$;

-- ---------------------------------------------------------------- goods received (bulk stock-in)
-- p_lines: [{product_id} or {new: {ref?, name, name_mr?, name_en?, category?, unit}}, qty, cost_paise?, sell_price_paise?]
-- qty is in the product's unit. cost_paise is what was paid for the whole line (optional).
-- sell_price_paise, when given, becomes the product's selling price for future bills (old bills keep theirs).
create or replace function public.record_stock_in(p_shop_id uuid, p_idempotency_key uuid, p_supplier text, p_note text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_prior jsonb;
  v_line jsonb; v_new jsonb;
  v_pid uuid; v_prod public.products;
  v_qty numeric; v_cost bigint; v_sell bigint;
  v_ref text; v_name text; v_unit text;
  v_today date;
  v_count int := 0; v_total bigint := 0;
  v_supplier text := app_private.clean_text(p_supplier, 80);
  v_note text := app_private.clean_text(p_note, 300);
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then perform app_private.fail('NO_ITEMS'); end if;
  if jsonb_array_length(p_lines) > 200 then perform app_private.fail('TOO_MANY_ITEMS'); end if;
  v_prior := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'record_stock_in',
    md5(jsonb_build_object('s', v_supplier, 'n', v_note, 'l', p_lines)::text));
  if v_prior is not null then return v_prior; end if;
  v_today := app_private.shop_today(p_shop_id);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pid := nullif(v_line ->> 'product_id', '')::uuid;
    v_new := v_line -> 'new';
    if v_pid is null then
      if v_new is null or jsonb_typeof(v_new) <> 'object' then perform app_private.fail('PRODUCT_NOT_FOUND'); end if;
      v_ref := v_new ->> 'ref';
      if v_ref is not null and v_ref !~ '^[a-z0-9-]{1,40}$' then perform app_private.fail('INVALID_ITEM'); end if;
      if v_ref is not null then
        select p.id into v_pid from public.products p where p.shop_id = p_shop_id and p.catalog_ref = v_ref;
      end if;
      if v_pid is null then
        v_name := app_private.clean_text(v_new ->> 'name', 120);
        if v_name is null then perform app_private.fail('NAME_REQUIRED'); end if;
        v_unit := v_new ->> 'unit';
        if v_unit is null or v_unit not in ('kg','g','litre','ml','packet','piece','dozen') then perform app_private.fail('INVALID_UNIT'); end if;
        v_sell := app_private.jpaise(v_line -> 'sell_price_paise');
        if v_sell is null then perform app_private.fail('PRICE_REQUIRED'); end if;
        v_pid := gen_random_uuid();
        insert into public.products(id, shop_id, name, name_en, name_mr, unit, default_price_paise, category, catalog_ref, created_by)
        values (v_pid, p_shop_id, v_name, app_private.clean_text(v_new ->> 'name_en', 120), app_private.clean_text(v_new ->> 'name_mr', 120),
                v_unit, v_sell, app_private.clean_text(v_new ->> 'category', 60), v_ref, v_uid);
        perform app_private.audit(p_shop_id, v_uid, 'product.created', 'product', v_pid::text, jsonb_build_object('via', 'stock_in'));
      end if;
    end if;

    select * into v_prod from public.products p where p.id = v_pid and p.shop_id = p_shop_id for update;
    if not found then perform app_private.fail('PRODUCT_NOT_FOUND'); end if;
    v_qty := app_private.jqty(v_line -> 'qty');
    v_cost := app_private.jpaise(v_line -> 'cost_paise');
    v_sell := app_private.jpaise(v_line -> 'sell_price_paise');
    if v_sell is not null and v_sell > 1000000000 then perform app_private.fail('INVALID_AMOUNT'); end if;

    insert into public.stock_entries(shop_id, batch_id, product_id, kind, qty, cost_paise, supplier, note, business_date, created_by)
    values (p_shop_id, p_idempotency_key, v_pid, 'purchase', v_qty, v_cost, v_supplier, v_note, v_today, v_uid);

    update public.products p set
      purchase_cost_paise = case when v_cost is not null then round(v_cost / v_qty)::bigint else p.purchase_cost_paise end,
      default_price_paise = coalesce(v_sell, p.default_price_paise),
      is_active = true,
      updated_at = now()
    where p.id = v_pid;
    if v_sell is not null and v_sell <> v_prod.default_price_paise then
      perform app_private.audit(p_shop_id, v_uid, 'product.price_changed', 'product', v_pid::text,
        jsonb_build_object('from', v_prod.default_price_paise, 'to', v_sell, 'via', 'stock_in'));
    end if;
    v_count := v_count + 1;
    v_total := v_total + coalesce(v_cost, 0);
  end loop;

  perform app_private.audit(p_shop_id, v_uid, 'stock.received', 'stock_batch', p_idempotency_key::text,
    jsonb_build_object('lines', v_count, 'cost_paise', v_total, 'supplier', v_supplier));
  return app_private.finish_mutation(p_shop_id, p_idempotency_key,
    jsonb_build_object('batch_id', p_idempotency_key, 'lines', v_count, 'cost_paise', v_total));
end $$;

-- ---------------------------------------------------------------- stock count (correction)
-- Records what is physically on the shelf; the difference from the computed stock is stored.
create or replace function public.count_stock(p_shop_id uuid, p_idempotency_key uuid, p_product_id uuid, p_counted jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_prior jsonb;
  v_counted numeric;
  v_now numeric;
  t text := p_counted #>> '{}';
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if t is null or t !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' or t::numeric > 100000 then perform app_private.fail('INVALID_QUANTITY'); end if;
  v_counted := t::numeric;
  v_prior := app_private.begin_mutation(p_shop_id, p_idempotency_key, 'count_stock',
    md5(jsonb_build_object('p', p_product_id, 'c', v_counted, 'n', p_note)::text));
  if v_prior is not null then return v_prior; end if;
  perform 1 from public.products p where p.id = p_product_id and p.shop_id = p_shop_id for update;
  if not found then perform app_private.fail('PRODUCT_NOT_FOUND'); end if;
  v_now := coalesce(app_private.stock_of(p_shop_id, p_product_id), 0);
  insert into public.stock_entries(shop_id, batch_id, product_id, kind, qty, note, business_date, created_by)
  values (p_shop_id, p_idempotency_key, p_product_id, 'count', v_counted - v_now, app_private.clean_text(p_note, 300),
          app_private.shop_today(p_shop_id), v_uid);
  perform app_private.audit(p_shop_id, v_uid, 'stock.counted', 'product', p_product_id::text,
    jsonb_build_object('before', v_now, 'counted', v_counted));
  return app_private.finish_mutation(p_shop_id, p_idempotency_key,
    jsonb_build_object('product_id', p_product_id, 'before', v_now, 'stock', v_counted));
end $$;

create or replace function public.set_reorder_level(p_shop_id uuid, p_product_id uuid, p_level jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t text := p_level #>> '{}';
  v numeric;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if t is null or t = '' then v := null;
  elsif t !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' or t::numeric > 100000 then perform app_private.fail('INVALID_QUANTITY');
  else v := t::numeric;
  end if;
  update public.products p set reorder_level = v, updated_at = now() where p.id = p_product_id and p.shop_id = p_shop_id;
  if not found then perform app_private.fail('PRODUCT_NOT_FOUND'); end if;
  return jsonb_build_object('product_id', p_product_id, 'reorder_level', v);
end $$;

-- ---------------------------------------------------------------- reads
create or replace function public.list_inventory(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
begin
  perform app_private.require_role(p_shop_id, 'owner');
  v_today := app_private.shop_today(p_shop_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_en', p.name_en, 'name_mr', p.name_mr,
      'unit', p.unit, 'default_price_paise', p.default_price_paise, 'purchase_cost_paise', p.purchase_cost_paise,
      'category', p.category, 'is_active', p.is_active, 'catalog_ref', p.catalog_ref, 'reorder_level', p.reorder_level,
      'stock', app_private.stock_of(p_shop_id, p.id),
      'sold_7d', app_private.sold_qty(p_shop_id, p.id, v_today - 6, v_today),
      'last_in_at', (select max(e.created_at) from public.stock_entries e where e.shop_id = p_shop_id and e.product_id = p.id and e.kind = 'purchase'))
      order by lower(p.name), p.created_at)
    from public.products p where p.shop_id = p_shop_id), '[]'::jsonb);
end $$;

create or replace function public.get_product_stock(p_shop_id uuid, p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.products;
  v_today date;
begin
  perform app_private.require_role(p_shop_id, 'owner');
  select * into p from public.products x where x.id = p_product_id and x.shop_id = p_shop_id;
  if not found then perform app_private.fail('PRODUCT_NOT_FOUND'); end if;
  v_today := app_private.shop_today(p_shop_id);
  return jsonb_build_object('id', p.id, 'name', p.name, 'name_en', p.name_en, 'name_mr', p.name_mr, 'unit', p.unit,
    'default_price_paise', p.default_price_paise, 'purchase_cost_paise', p.purchase_cost_paise, 'category', p.category,
    'is_active', p.is_active, 'catalog_ref', p.catalog_ref, 'reorder_level', p.reorder_level,
    'stock', app_private.stock_of(p_shop_id, p.id),
    'sold_today', app_private.sold_qty(p_shop_id, p.id, v_today, v_today),
    'sold_7d', app_private.sold_qty(p_shop_id, p.id, v_today - 6, v_today),
    'sold_30d', app_private.sold_qty(p_shop_id, p.id, v_today - 29, v_today),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'qty', e.qty, 'cost_paise', e.cost_paise,
        'supplier', e.supplier, 'note', e.note, 'business_date', e.business_date, 'created_at', e.created_at) order by e.created_at desc)
      from (select * from public.stock_entries e where e.shop_id = p_shop_id and e.product_id = p.id order by e.created_at desc limit 50) e), '[]'::jsonb));
end $$;

-- Sales insights for a date range: who bought most, what sold most, day by day, dues, stock alerts.
create or replace function public.get_insights(p_shop_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'owner');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then perform app_private.fail('INVALID_RANGE'); end if;
  return jsonb_build_object('from', p_from, 'to', p_to, 'today', app_private.shop_today(p_shop_id),
    'totals', app_private.day_summary(p_shop_id, p_from, p_to),
    'customers', coalesce((
      select jsonb_agg(x order by (x ->> 'amount_paise')::bigint desc) from (
        select jsonb_build_object('customer_id', i.customer_id, 'name', coalesce(c.name, i.customer_name),
          'amount_paise', sum(i.total_paise), 'bills', count(*), 'due_paise', coalesce(max(b.balance_paise), 0)) as x
        from public.invoices i
        left join public.customers c on c.id = i.customer_id
        left join public.customer_balances b on b.customer_id = i.customer_id
        where i.shop_id = p_shop_id and i.status = 'posted' and i.business_date between p_from and p_to
        group by i.customer_id, coalesce(c.name, i.customer_name)
        order by sum(i.total_paise) desc limit 50) t), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(x order by (x ->> 'amount_paise')::bigint desc) from (
        select jsonb_build_object('product_id', ii.product_id, 'name', coalesce(max(p.name), max(ii.name)),
          'unit', coalesce(max(p.unit), max(ii.unit)),
          'qty', round(sum(case when p.id is null then ii.qty else ii.qty * coalesce(r.num, 0) / coalesce(r.den, 1) end), 3),
          'amount_paise', sum(ii.line_total_paise), 'bills', count(distinct ii.invoice_id),
          'linked', ii.product_id is not null) as x
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        left join public.products p on p.id = ii.product_id
        left join lateral app_private.unit_ratio(ii.unit, p.unit) r on p.id is not null
        where ii.shop_id = p_shop_id and i.status = 'posted' and i.business_date between p_from and p_to
        group by ii.product_id, case when ii.product_id is null then lower(btrim(ii.name)) || '|' || ii.unit else '' end
        order by sum(ii.line_total_paise) desc limit 50) t), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.d::date, 'sales_paise', coalesce(s.amt, 0), 'bills', coalesce(s.n, 0),
          'collected_paise', coalesce(pm.amt, 0)) order by d.d)
      from generate_series(p_from, p_to, interval '1 day') as d(d)
      left join (select i.business_date, sum(i.total_paise) as amt, count(*) as n from public.invoices i
                 where i.shop_id = p_shop_id and i.status = 'posted' and i.business_date between p_from and p_to
                 group by i.business_date) s on s.business_date = d.d::date
      left join (select p.business_date, sum(p.amount_paise) as amt from public.payments p
                 where p.shop_id = p_shop_id and p.status = 'posted' and p.business_date between p_from and p_to
                 group by p.business_date) pm on pm.business_date = d.d::date), '[]'::jsonb),
    'dues', jsonb_build_object(
      'total_paise', coalesce((select sum(b.balance_paise) from public.customer_balances b where b.shop_id = p_shop_id and b.balance_paise > 0), 0),
      'customers', (select count(*) from public.customer_balances b where b.shop_id = p_shop_id and b.balance_paise > 0),
      'top', coalesce((select jsonb_agg(jsonb_build_object('customer_id', c.id, 'name', c.name, 'due_paise', b.balance_paise) order by b.balance_paise desc)
        from (select * from public.customer_balances b where b.shop_id = p_shop_id and b.balance_paise > 0 order by b.balance_paise desc limit 5) b
        join public.customers c on c.id = b.customer_id), '[]'::jsonb)),
    'low_stock', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', p.unit, 'stock', s.stock, 'reorder_level', p.reorder_level) as x
        from public.products p cross join lateral (select app_private.stock_of(p_shop_id, p.id) as stock) s
        where p.shop_id = p_shop_id and p.is_active and s.stock is not null
          and s.stock <= coalesce(p.reorder_level, 0)
        order by s.stock limit 30) t), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- AI key (server only)
create or replace function public.svc_ai_key()
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'gemini_api_key' order by s.created_at desc limit 1;
$$;

-- ---------------------------------------------------------------- grants
revoke execute on function app_private.stock_of(uuid, uuid), app_private.sold_qty(uuid, uuid, date, date),
  app_private.clean_text(text, int) from public, anon, authenticated;
revoke execute on function
  public.add_catalog_products(uuid, jsonb), public.record_stock_in(uuid, uuid, text, text, jsonb),
  public.count_stock(uuid, uuid, uuid, jsonb, text), public.set_reorder_level(uuid, uuid, jsonb),
  public.list_inventory(uuid), public.get_product_stock(uuid, uuid), public.get_insights(uuid, date, date),
  public.svc_ai_key()
from public, anon;
grant execute on function
  public.add_catalog_products(uuid, jsonb), public.record_stock_in(uuid, uuid, text, text, jsonb),
  public.count_stock(uuid, uuid, uuid, jsonb, text), public.set_reorder_level(uuid, uuid, jsonb),
  public.list_inventory(uuid), public.get_product_stock(uuid, uuid), public.get_insights(uuid, date, date)
to authenticated;
revoke execute on function public.svc_ai_key() from authenticated;
grant execute on function public.svc_ai_key() to service_role;

-- Change only the selling price of a product (old bills keep the price they were sold at).
create or replace function public.set_product_price(p_shop_id uuid, p_product_id uuid, p_price_paise jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_price bigint := app_private.jpaise(p_price_paise);
  v_old bigint;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if v_price is null or v_price > 1000000000 then perform app_private.fail('PRICE_REQUIRED'); end if;
  select p.default_price_paise into v_old from public.products p where p.id = p_product_id and p.shop_id = p_shop_id for update;
  if not found then perform app_private.fail('PRODUCT_NOT_FOUND'); end if;
  update public.products p set default_price_paise = v_price, updated_at = now() where p.id = p_product_id;
  if v_old <> v_price then
    perform app_private.audit(p_shop_id, v_uid, 'product.price_changed', 'product', p_product_id::text,
      jsonb_build_object('from', v_old, 'to', v_price));
  end if;
  return jsonb_build_object('product_id', p_product_id, 'default_price_paise', v_price);
end $$;
revoke execute on function public.set_product_price(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_product_price(uuid, uuid, jsonb) to authenticated;
