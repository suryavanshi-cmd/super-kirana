-- Voice-entry gateway (Cloud Run) context: ONE read-only call per cache miss.
-- Called with the service-role key only. It re-checks that the signed-in user (taken from their
-- verified JWT by the gateway, never from the client body) is an active member of the shop, and
-- returns only what speech recognition and name matching need: customer ids + names ranked by
-- recent activity, and item names. No balances, mobiles or money.
create or replace function public.svc_voice_context(p_user_id uuid, p_shop_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_shop uuid;
  v_count int;
begin
  if p_user_id is null then perform app_private.fail('NOT_AUTHENTICATED'); end if;
  if p_shop_id is null then
    select count(*), min(m.shop_id::text)::uuid into v_count, v_shop
      from public.shop_members m join public.shops s on s.id = m.shop_id
     where m.user_id = p_user_id and m.membership_status = 'active' and s.status = 'active';
    if v_count = 0 then perform app_private.fail('FORBIDDEN'); end if;
    if v_count > 1 then perform app_private.fail('SHOP_REQUIRED'); end if;
  else
    select m.shop_id into v_shop from public.shop_members m join public.shops s on s.id = m.shop_id
     where m.user_id = p_user_id and m.shop_id = p_shop_id and m.membership_status = 'active' and s.status = 'active';
    if not found then perform app_private.fail('FORBIDDEN'); end if;
  end if;

  return jsonb_build_object(
    'shop_id', v_shop,
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.last_at desc nulls last, x.name)
      from (
        select c.id, c.name,
               (select max(l.posted_at) from public.ledger_entries l where l.shop_id = v_shop and l.customer_id = c.id) as last_at
          from public.customers c
         where c.shop_id = v_shop and c.is_active and c.deleted_at is null
         limit 2000
      ) x), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(n) from (
        select distinct on (lower(n)) n from (
          (select coalesce(p.name_mr, p.name) as n from public.products p where p.shop_id = v_shop and p.is_active limit 500)
          union all
          (select p.name_en from public.products p where p.shop_id = v_shop and p.is_active and p.name_en is not null limit 500)
          union all
          (select i.name from public.invoice_items i join public.invoices v on v.id = i.invoice_id and v.shop_id = i.shop_id
            where i.shop_id = v_shop order by v.posted_at desc limit 300)
        ) u where n is not null and length(n) <= 64
      ) d), '[]'::jsonb)
  );
end $$;

revoke execute on function public.svc_voice_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_voice_context(uuid, uuid) to service_role;
