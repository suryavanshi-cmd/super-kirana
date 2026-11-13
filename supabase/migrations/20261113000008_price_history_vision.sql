-- Price history ("दर इतिहास") and the photo → bill reader's support functions. Additive only.
-- Every change of a product's selling price is recorded by a trigger, whatever screen made it, with the
-- time, the person and how it was changed (typed, mic, photo, goods received, ready list).

create table if not exists public.product_price_history (
  id bigint generated always as identity primary key,
  shop_id uuid not null,
  product_id uuid not null,
  old_price_paise bigint,
  new_price_paise bigint not null,
  unit text not null,
  source text not null check (source in ('manual','voice','photo','stock_in','catalog','created','baseline')),
  changed_by uuid references public.profiles(user_id),
  changed_at timestamptz not null default now(),
  foreign key (shop_id, product_id) references public.products(shop_id, id)
);
create index if not exists product_price_history_idx on public.product_price_history(shop_id, product_id, changed_at desc);

alter table public.product_price_history enable row level security;
drop policy if exists product_price_history_select on public.product_price_history;
create policy product_price_history_select on public.product_price_history for select to authenticated
  using (app_private.has_shop_access(shop_id));
revoke all on public.product_price_history from anon, authenticated;
grant select on public.product_price_history to authenticated;
drop trigger if exists product_price_history_immutable on public.product_price_history;
create trigger product_price_history_immutable before update or delete on public.product_price_history
  for each row execute function app_private.deny_change();

create or replace function app_private.log_price_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_src text := nullif(current_setting('app.price_source', true), '');
begin
  if v_src is null or v_src not in ('manual','voice','photo','stock_in','catalog') then v_src := 'manual'; end if;
  if tg_op = 'INSERT' then
    insert into public.product_price_history(shop_id, product_id, old_price_paise, new_price_paise, unit, source, changed_by)
    values (new.shop_id, new.id, null, new.default_price_paise, new.unit,
            case when v_src in ('catalog','stock_in') then v_src else 'created' end, auth.uid());
  elsif new.default_price_paise is distinct from old.default_price_paise or new.unit is distinct from old.unit then
    insert into public.product_price_history(shop_id, product_id, old_price_paise, new_price_paise, unit, source, changed_by)
    values (new.shop_id, new.id, old.default_price_paise, new.default_price_paise, new.unit, v_src, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists products_price_history on public.products;
create trigger products_price_history after insert or update of default_price_paise, unit on public.products
  for each row execute function app_private.log_price_change();

-- Starting point for products that existed before history was kept.
insert into public.product_price_history(shop_id, product_id, old_price_paise, new_price_paise, unit, source, changed_by, changed_at)
select p.shop_id, p.id, null, p.default_price_paise, p.unit, 'baseline', null, now()
from public.products p
where not exists (select 1 from public.product_price_history h where h.product_id = p.id);

-- Owner changes a selling price from any screen; p_source says how (typed / mic / photo).
create or replace function public.change_product_price(p_shop_id uuid, p_product_id uuid, p_price_paise jsonb, p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_price bigint := app_private.jpaise(p_price_paise);
  v_old bigint;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  if p_source is null or p_source not in ('manual','voice','photo') then perform app_private.fail('INVALID_INPUT'); end if;
  if v_price is null or v_price > 1000000000 then perform app_private.fail('PRICE_REQUIRED'); end if;
  select p.default_price_paise into v_old from public.products p where p.id = p_product_id and p.shop_id = p_shop_id for update;
  if not found then perform app_private.fail('PRODUCT_NOT_FOUND'); end if;
  perform set_config('app.price_source', p_source, true);
  update public.products p set default_price_paise = v_price, updated_at = now() where p.id = p_product_id;
  if v_old <> v_price then
    perform app_private.audit(p_shop_id, v_uid, 'product.price_changed', 'product', p_product_id::text,
      jsonb_build_object('from', v_old, 'to', v_price, 'via', p_source));
  end if;
  return jsonb_build_object('product_id', p_product_id, 'old_price_paise', v_old, 'default_price_paise', v_price);
end $$;

create or replace function public.get_price_history(p_shop_id uuid, p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'old_price_paise', h.old_price_paise, 'new_price_paise', h.new_price_paise,
      'unit', h.unit, 'source', h.source, 'changed_at', h.changed_at, 'changed_by_name', pr.display_name) order by h.changed_at desc, h.id desc)
    from (select * from public.product_price_history x where x.shop_id = p_shop_id and x.product_id = p_product_id
          order by x.changed_at desc, x.id desc limit 200) h
    left join public.profiles pr on pr.user_id = h.changed_by), '[]'::jsonb);
end $$;

-- Compact list of the shop's items for the photo reader (names and prices only, no customer data).
create or replace function public.svc_bill_catalogue(p_shop_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'name_mr', p.name_mr, 'name_en', p.name_en,
    'unit', p.unit, 'price', p.default_price_paise) order by lower(p.name)), '[]'::jsonb)
  from (select * from public.products x where x.shop_id = p_shop_id and x.is_active order by x.updated_at desc limit 2000) p;
$$;

-- set_product_price (from the stock screen) is a typed change.
create or replace function public.set_product_price(p_shop_id uuid, p_product_id uuid, p_price_paise jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.change_product_price(p_shop_id, p_product_id, p_price_paise, 'manual');
end $$;

create or replace function public.add_catalog_products(p_shop_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_ref text; v_name text; v_unit text; v_price bigint; v_level numeric;
  v_added int := 0; v_skipped int := 0; v_ids jsonb := '{}'::jsonb; v_id uuid;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  perform set_config('app.price_source', 'catalog', true);
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
  perform set_config('app.price_source', 'stock_in', true);
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

revoke execute on function app_private.log_price_change() from public, anon, authenticated;
revoke execute on function public.change_product_price(uuid, uuid, jsonb, text), public.get_price_history(uuid, uuid),
  public.svc_bill_catalogue(uuid) from public, anon;
grant execute on function public.change_product_price(uuid, uuid, jsonb, text), public.get_price_history(uuid, uuid) to authenticated;
revoke execute on function public.svc_bill_catalogue(uuid) from authenticated;
grant execute on function public.svc_bill_catalogue(uuid) to service_role;
