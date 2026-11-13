-- Delete a customer (owner only, balance must be ₹0). Nothing financial is erased: the customer row
-- is marked deleted and hidden from every list, while their old bills and payments stay in reports,
-- so past daily totals never change. A deleted customer cannot get new bills (is_active = false).
alter table public.customers add column if not exists deleted_at timestamptz;

create or replace function public.list_customers(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role(p_shop_id, 'cashier');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'mobile', c.mobile, 'is_active', c.is_active,
      'balance_paise', coalesce(b.balance_paise, 0),
      'last_at', (select max(l.posted_at) from public.ledger_entries l where l.shop_id = p_shop_id and l.customer_id = c.id))
      order by lower(c.name), c.created_at)
    from public.customers c left join public.customer_balances b on b.customer_id = c.id
    where c.shop_id = p_shop_id and c.deleted_at is null), '[]'::jsonb);
end $$;

create or replace function public.delete_customer(p_shop_id uuid, p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_name text;
begin
  perform app_private.require_role(p_shop_id, 'owner', true);
  select c.name into v_name from public.customers c
   where c.shop_id = p_shop_id and c.id = p_customer_id and c.deleted_at is null for update;
  if not found then perform app_private.fail('CUSTOMER_NOT_FOUND'); end if;
  -- The maintained balance: the same number every screen shows.
  select coalesce((select b.balance_paise from public.customer_balances b where b.customer_id = p_customer_id), 0) into v_balance;
  if v_balance <> 0 then perform app_private.fail('BALANCE_NOT_ZERO'); end if;
  update public.customers set deleted_at = now(), is_active = false, updated_at = now()
   where shop_id = p_shop_id and id = p_customer_id;
  perform app_private.audit(p_shop_id, v_uid, 'customer.deleted', 'customer', p_customer_id::text, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', p_customer_id, 'deleted', true);
end $$;

revoke execute on function public.delete_customer(uuid, uuid) from public, anon;
grant execute on function public.delete_customer(uuid, uuid) to authenticated;

-- Demo: 100 actions per day (was 30), so live checks and a person can both use it the same day.
update public.demo_access set daily_limit = 100 where id = 1 and daily_limit < 100;
