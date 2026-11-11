-- Sample data for LOCAL testing only. Run after first-run setup on the local stack:
--   psql -d kirana_e2e -f tests/harness/seed-local.sql
-- Adds products and customers to the seeded shop. Never run this on a production database.
do $$
declare
  v_shop uuid; v_user uuid; c record; v_id uuid;
begin
  select s.id into v_shop from public.shops s where s.shop_username = 'superkirana-niphad';
  select m.user_id into v_user from public.shop_members m where m.shop_id = v_shop and m.role = 'owner' limit 1;
  if v_shop is null or v_user is null then raise exception 'run the first-time setup first'; end if;
  insert into public.products(shop_id, name, name_en, unit, default_price_paise, category, created_by) values
    (v_shop, 'साखर', 'Sugar', 'kg', 4200, 'किराणा', v_user), (v_shop, 'तांदूळ', 'Rice', 'kg', 6000, 'किराणा', v_user),
    (v_shop, 'गहू पीठ', 'Wheat flour', 'kg', 3800, 'किराणा', v_user), (v_shop, 'तूर डाळ', 'Toor dal', 'kg', 14000, 'डाळी', v_user),
    (v_shop, 'शेंगदाणा तेल', 'Groundnut oil', 'litre', 18000, 'तेल', v_user), (v_shop, 'दूध', 'Milk', 'litre', 5600, 'दुग्ध', v_user),
    (v_shop, 'चहा पावडर', 'Tea', 'packet', 12000, 'पेये', v_user), (v_shop, 'मीठ', 'Salt', 'packet', 2500, 'किराणा', v_user),
    (v_shop, 'अंडी', 'Eggs', 'dozen', 8400, 'इतर', v_user), (v_shop, 'साबण', 'Soap', 'piece', 3500, 'इतर', v_user);
  for c in select * from (values ('सुरेश पाटील', '9876500001', 50000), ('मीना जाधव', '9876500002', 0), ('अनिल शिंदे', null, 125000)) t(name, mobile, opening) loop
    v_id := gen_random_uuid();
    insert into public.customers(id, shop_id, name, mobile, created_by) values (v_id, v_shop, c.name, c.mobile, v_user);
    insert into public.customer_balances(customer_id, shop_id) values (v_id, v_shop);
    if c.opening > 0 then
      insert into public.ledger_entries(shop_id, customer_id, entry_type, amount_paise, business_date, created_by, note)
      values (v_shop, v_id, 'opening_balance', c.opening, app_private.shop_today(v_shop), v_user, 'opening balance');
    end if;
  end loop;
end $$;
