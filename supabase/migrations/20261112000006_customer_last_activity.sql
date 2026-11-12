-- Customer list for the home screen: add the time of each customer's last ledger entry, so the
-- shopkeeper can see who has not paid for a long time.
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
    where c.shop_id = p_shop_id), '[]'::jsonb);
end $$;
