-- Demo mode: anyone with the demo code can open a ready-made demo shop (in English) without a
-- username or password. Everything works and is stored normally, but the whole demo shop is limited
-- to a fixed number of actions per day (default 30): every save (bill, payment, customer, stock,
-- price…) and every AI call (photo bill, AI summary, cloud speech) uses one.
--
-- Isolation: the demo user is a member of the demo shop only, is never an admin, cannot change its
-- password, add staff or create shops (auth-admin refuses), so it can never reach real shops.
-- The code is stored only as a SHA-256 hash; it is checked by the server (auth-admin), never in the
-- browser. Change it with:  update public.demo_access set code_hash = encode(sha256(upper('NEWCODE')::bytea), 'hex');

create table if not exists public.demo_access (
  id int primary key default 1 check (id = 1),
  code_hash text not null,
  enabled boolean not null default true,
  daily_limit int not null default 30 check (daily_limit between 1 and 10000),
  shop_id uuid references public.shops(id),
  user_id uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.demo_usage (
  shop_id uuid not null references public.shops(id),
  day date not null,
  used int not null default 0,
  primary key (shop_id, day)
);
alter table public.demo_access enable row level security;
alter table public.demo_usage enable row level security;
revoke all on public.demo_access, public.demo_usage from anon, authenticated;
-- No policies: only security-definer functions and the service role can read these tables.

-- Initial code: GAURAV1234 (codes are compared in upper case, spaces removed). Change it any time.
insert into public.demo_access(id, code_hash) values (1, encode(sha256('GAURAV1234'::bytea), 'hex'))
on conflict (id) do nothing;

create or replace function app_private.is_demo_shop(p_shop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.demo_access d where d.shop_id = p_shop);
$$;

-- Uses one demo action; refuses with DEMO_LIMIT when today's actions are used up. Real shops: no-op.
create or replace function app_private.demo_charge(p_shop uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_limit int;
  v_used int;
begin
  select d.daily_limit into v_limit from public.demo_access d where d.shop_id = p_shop;
  if not found then return; end if;
  if coalesce(current_setting('app.demo_free', true), '') = '1' then return; end if;   -- seeding / logging
  insert into public.demo_usage(shop_id, day, used) values (p_shop, app_private.shop_today(p_shop), 1)
  on conflict (shop_id, day) do update set used = public.demo_usage.used + 1
  returning used into v_used;
  if v_used > v_limit then perform app_private.fail('DEMO_LIMIT'); end if;
end $$;

-- Every write in the app already passes through require_role(…, p_write => true): demo shops are
-- charged there, so no individual function needed changing. (Real shops are unaffected.)
create or replace function app_private.require_role(p_shop_id uuid, p_min text, p_write boolean default false)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text;
begin
  if auth.uid() is null then perform app_private.fail('NOT_AUTHENTICATED'); end if;
  v_role := app_private.shop_role(p_shop_id);
  if v_role is null then perform app_private.fail('FORBIDDEN'); end if;
  if p_min = 'owner' and v_role <> 'owner' then perform app_private.fail('OWNER_ONLY'); end if;
  if p_write and not exists (select 1 from public.shops s where s.id = p_shop_id and s.status = 'active') then
    perform app_private.fail('SHOP_SUSPENDED');
  end if;
  if p_write and app_private.is_demo_shop(p_shop_id) then perform app_private.demo_charge(p_shop_id); end if;
  return v_role;
end $$;

-- The photo reader already used an action for the photo; keeping its short log is free.
create or replace function public.log_ocr_job(p_shop_id uuid, p_provider text, p_status text, p_raw_text text, p_items jsonb, p_mean_confidence numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform set_config('app.demo_free', '1', true);
  perform app_private.require_role(p_shop_id, 'cashier', true);
  perform set_config('app.demo_free', '', true);
  if p_status not in ('recognized','low_confidence','failed') then perform app_private.fail('INVALID_STATUS'); end if;
  delete from public.ocr_jobs o where o.shop_id = p_shop_id and o.created_at < now() - interval '30 days'
    and not exists (select 1 from public.invoices i where i.ocr_job_id = o.id);
  insert into public.ocr_jobs(shop_id, created_by, provider, status, raw_text, items, mean_confidence)
  values (p_shop_id, auth.uid(), left(coalesce(p_provider, 'unknown'), 40), p_status, left(p_raw_text, 20000),
          coalesce(p_items, '[]'::jsonb), p_mean_confidence)
  returning id into v_id;
  return v_id;
end $$;

-- For the shop screens: is this the demo shop, and how many actions are left today?
create or replace function public.get_demo_status(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int;
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  select d.daily_limit into v_limit from public.demo_access d where d.shop_id = p_shop_id;
  if not found then return jsonb_build_object('is_demo', false); end if;
  return jsonb_build_object('is_demo', true, 'limit', v_limit,
    'used', coalesce((select u.used from public.demo_usage u where u.shop_id = p_shop_id and u.day = app_private.shop_today(p_shop_id)), 0));
end $$;

-- ---------------------------------------------------------------- service functions (auth-admin / AI functions)
create or replace function public.svc_demo_check(p_code_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', d.enabled and d.code_hash = p_code_hash, 'user_id', d.user_id, 'shop_id', d.shop_id)
  from public.demo_access d where d.id = 1;
$$;

create or replace function public.svc_is_demo_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.demo_access d where d.user_id = p_user_id);
$$;

-- AI functions (photo, summary, speech) use an action for demo shops; true = allowed.
create or replace function public.svc_demo_charge(p_shop_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app_private.demo_charge(p_shop_id);
  return true;
exception when others then
  return false;
end $$;

-- Creates the demo profile, shop and sample data once (called by auth-admin with a new auth user).
create or replace function public.svc_demo_bootstrap(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_shop uuid;
  v_c jsonb;
  v_p record;
  v_cust uuid[] := '{}';
  v_prod jsonb := '{}'::jsonb;
  v_id uuid;
begin
  select d.shop_id into v_shop from public.demo_access d where d.id = 1 for update;
  if v_shop is not null then return jsonb_build_object('shop_id', v_shop, 'created', false); end if;

  insert into public.profiles(user_id, login_username, display_name, preferred_language, must_change_password)
  values (p_user_id, 'demo-owner', 'Demo Owner', 'en-IN', false);
  insert into public.shops(shop_username, name_mr, name_en, default_locale, secondary_locale)
  values ('demo-kirana', 'डेमो किराणा स्टोअर', 'Demo Kirana Store', 'en-IN', 'mr-IN') returning id into v_shop;
  insert into public.shop_members(shop_id, user_id, role) values (v_shop, p_user_id, 'owner');
  update public.demo_access set shop_id = v_shop, user_id = p_user_id, updated_at = now() where id = 1;

  -- Sample data is entered through the normal functions, as the demo owner, without using actions.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('app.demo_free', '1', true);

  for v_p in select * from (values
      ('sugar', 'Sugar (loose)', 'साखर (सुटे)', 'kg', 4600), ('toor-dal', 'Toor Dal (loose)', 'तूर डाळ (सुटे)', 'kg', 15000),
      ('peanuts', 'Peanuts (loose)', 'शेंगदाणे (सुटे)', 'kg', 13000), ('rice-kolam', 'Rice Kolam (loose)', 'कोलम तांदूळ (सुटे)', 'kg', 5800),
      ('atta', 'Aashirvaad Atta 5 kg', 'आशीर्वाद आटा 5 किलो', 'packet', 29000), ('oil', 'Fortune Sunflower Oil 1 L', 'फॉर्च्यून सूर्यफूल तेल 1 लिटर', 'piece', 16500),
      ('tea', 'Tata Tea Premium 250 g', 'टाटा टी प्रीमियम 250 ग्रॅम', 'packet', 15500), ('parle-g', 'Parle-G 100 g', 'पार्ले जी 100 ग्रॅम', 'packet', 1000),
      ('milk', 'Gokul Full Cream Milk 500 ml', 'गोकुळ फुल क्रीम दूध 500 मिली', 'piece', 3600), ('poha', 'Poha Thick (loose)', 'जाड पोहे (सुटे)', 'kg', 5500),
      ('soap', 'Lifebuoy Soap 100 g', 'लाइफबॉय साबण 100 ग्रॅम', 'piece', 3500), ('salt', 'Tata Salt 1 kg', 'टाटा मीठ 1 किलो', 'packet', 2800))
    as t(ref, name_en, name_mr, unit, price) loop
    v_id := (public.add_catalog_products(v_shop, jsonb_build_array(jsonb_build_object('ref', 'demo-' || v_p.ref, 'name', v_p.name_en,
      'name_en', v_p.name_en, 'name_mr', v_p.name_mr, 'unit', v_p.unit, 'price_paise', v_p.price, 'reorder_level', '5'))) -> 'ids' ->> ('demo-' || v_p.ref))::uuid;
    v_prod := v_prod || jsonb_build_object(v_p.ref, jsonb_build_object('id', v_id, 'name', v_p.name_en, 'unit', v_p.unit, 'price', v_p.price));
  end loop;
  perform public.record_stock_in(v_shop, gen_random_uuid(), 'Demo Wholesaler', null, jsonb_build_array(
    jsonb_build_object('product_id', v_prod -> 'sugar' ->> 'id', 'qty', '50', 'cost_paise', 210000),
    jsonb_build_object('product_id', v_prod -> 'toor-dal' ->> 'id', 'qty', '25', 'cost_paise', 337500),
    jsonb_build_object('product_id', v_prod -> 'peanuts' ->> 'id', 'qty', '4', 'cost_paise', 46000),
    jsonb_build_object('product_id', v_prod -> 'parle-g' ->> 'id', 'qty', '60', 'cost_paise', 51000)));

  for v_c in select * from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('name', 'Suresh Patil', 'mobile', '9876500001', 'opening', 50000),
      jsonb_build_object('name', 'Meena Jadhav', 'mobile', '9876500002', 'opening', 0),
      jsonb_build_object('name', 'Hotel Ambari', 'mobile', '9876500003', 'opening', 125000),
      jsonb_build_object('name', 'Ramesh Shinde', 'mobile', '9876500004', 'opening', 0),
      jsonb_build_object('name', 'Anita More', 'mobile', '9876500005', 'opening', 30000))) loop
    v_id := gen_random_uuid();
    perform public.save_customer(v_shop, jsonb_build_object('new_id', v_id, 'name', v_c ->> 'name', 'mobile', v_c ->> 'mobile',
      'notes', 'Demo customer', 'opening_balance_paise', (v_c ->> 'opening')::bigint));
    v_cust := v_cust || v_id;
  end loop;

  -- A few of today's bills so the charts and summary have something to show.
  perform public.create_invoice(v_shop, gen_random_uuid(), v_cust[1], jsonb_build_array(
      jsonb_build_object('product_id', v_prod -> 'sugar' ->> 'id', 'name', 'Sugar (loose)', 'qty', '2', 'unit', 'kg', 'price_unit', 'kg', 'unit_price_paise', 4600, 'discount_paise', 0),
      jsonb_build_object('product_id', v_prod -> 'toor-dal' ->> 'id', 'name', 'Toor Dal (loose)', 'qty', '1', 'unit', 'kg', 'price_unit', 'kg', 'unit_price_paise', 15000, 'discount_paise', 0)),
    10000, 'cash', null, 'Demo bill', 'manual', null);
  perform public.create_invoice(v_shop, gen_random_uuid(), v_cust[3], jsonb_build_array(
      jsonb_build_object('product_id', v_prod -> 'oil' ->> 'id', 'name', 'Fortune Sunflower Oil 1 L', 'qty', '5', 'unit', 'piece', 'price_unit', 'piece', 'unit_price_paise', 16500, 'discount_paise', 0),
      jsonb_build_object('product_id', v_prod -> 'rice-kolam' ->> 'id', 'name', 'Rice Kolam (loose)', 'qty', '10', 'unit', 'kg', 'price_unit', 'kg', 'unit_price_paise', 5800, 'discount_paise', 0)),
    0, 'cash', null, 'Demo bill', 'manual', null);
  perform public.create_invoice(v_shop, gen_random_uuid(), v_cust[2], jsonb_build_array(
      jsonb_build_object('product_id', v_prod -> 'parle-g' ->> 'id', 'name', 'Parle-G 100 g', 'qty', '6', 'unit', 'packet', 'price_unit', 'packet', 'unit_price_paise', 1000, 'discount_paise', 0),
      jsonb_build_object('product_id', v_prod -> 'milk' ->> 'id', 'name', 'Gokul Full Cream Milk 500 ml', 'qty', '2', 'unit', 'piece', 'price_unit', 'piece', 'unit_price_paise', 3600, 'discount_paise', 0)),
    13200, 'upi', null, 'Demo bill', 'manual', null);
  perform public.create_invoice(v_shop, gen_random_uuid(), null, jsonb_build_array(
      jsonb_build_object('product_id', v_prod -> 'peanuts' ->> 'id', 'name', 'Peanuts (loose)', 'qty', '1', 'unit', 'kg', 'price_unit', 'kg', 'unit_price_paise', 13000, 'discount_paise', 0)),
    13000, 'cash', null, 'Demo walk-in bill', 'manual', null);

  perform set_config('app.demo_free', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return jsonb_build_object('shop_id', v_shop, 'created', true);
end $$;

revoke execute on function app_private.is_demo_shop(uuid), app_private.demo_charge(uuid) from public, anon, authenticated;
revoke execute on function public.get_demo_status(uuid), public.svc_demo_check(text), public.svc_is_demo_user(uuid),
  public.svc_demo_charge(uuid), public.svc_demo_bootstrap(uuid) from public, anon;
grant execute on function public.get_demo_status(uuid) to authenticated;
revoke execute on function public.svc_demo_check(text), public.svc_is_demo_user(uuid), public.svc_demo_charge(uuid),
  public.svc_demo_bootstrap(uuid) from authenticated;
grant execute on function public.svc_demo_check(text), public.svc_is_demo_user(uuid), public.svc_demo_charge(uuid),
  public.svc_demo_bootstrap(uuid) to service_role;
