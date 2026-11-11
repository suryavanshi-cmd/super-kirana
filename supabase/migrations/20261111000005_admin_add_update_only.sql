-- The platform admin manages shops and their people (add + update only). The admin no longer has
-- implicit access to any shop's customers, bills or money: only shops where they are a member.

create or replace function app_private.shop_role(p_shop_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null or p_shop_id is null then return null; end if;
  if exists (select 1 from public.profiles p where p.user_id = v_uid and p.must_change_password) then
    return null;
  end if;
  select m.role into v_role
  from public.shop_members m join public.shops s on s.id = m.shop_id
  where m.shop_id = p_shop_id and m.user_id = v_uid
    and m.membership_status = 'active' and s.status = 'active';
  return v_role;
end $$;

create or replace function public.my_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_shops jsonb;
begin
  if v_uid is null then perform app_private.fail('NOT_AUTHENTICATED'); end if;
  select * into v_p from public.profiles p where p.user_id = v_uid;
  if not found then perform app_private.fail('PROFILE_MISSING'); end if;
  if v_p.must_change_password then
    v_shops := '[]'::jsonb;
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
    'is_platform_admin', app_private.is_admin(v_uid), 'shops', v_shops);
end $$;

-- Owners keep managing cashiers inside their own shop; owner changes are done by the admin below.
create or replace function public.set_member(p_shop_id uuid, p_user_id uuid, p_role text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  m public.shop_members;
begin
  perform app_private.require_role(p_shop_id, 'owner');
  if p_role not in ('owner','cashier') or p_status not in ('active','disabled') then perform app_private.fail('INVALID_INPUT'); end if;
  select * into m from public.shop_members x where x.shop_id = p_shop_id and x.user_id = p_user_id for update;
  if not found then perform app_private.fail('MEMBER_NOT_FOUND'); end if;
  if m.role = 'owner' or p_role = 'owner' or p_user_id = v_uid then
    perform app_private.fail('ADMIN_ONLY', 'only the platform admin can change owners');
  end if;
  update public.shop_members x set role = p_role, membership_status = p_status, updated_at = now()
  where x.shop_id = p_shop_id and x.user_id = p_user_id;
  if p_status = 'disabled' then perform app_private.revoke_sessions(p_user_id); end if;
  perform app_private.audit(p_shop_id, v_uid, 'member.updated', 'user', p_user_id::text,
    jsonb_build_object('role', p_role, 'status', p_status, 'previous_role', m.role, 'previous_status', m.membership_status));
  return jsonb_build_object('user_id', p_user_id, 'role', p_role, 'status', p_status);
end $$;

-- ---------------------------------------------------------------- admin: add + update
create or replace function public.admin_list_shops()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'shop_username', s.shop_username, 'name_mr', s.name_mr, 'name_en', s.name_en,
      'status', s.status, 'created_at', s.created_at,
      'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', p.login_username,
          'display_name', p.display_name, 'role', m.role, 'status', m.membership_status, 'must_change_password', p.must_change_password)
          order by m.role desc, lower(p.display_name))
        from public.shop_members m join public.profiles p on p.user_id = m.user_id where m.shop_id = s.id), '[]'::jsonb))
      order by s.created_at)
    from public.shops s), '[]'::jsonb);
end $$;

create or replace function public.admin_update_shop(p_shop_id uuid, p_name_mr text, p_name_en text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_admin();
begin
  if length(btrim(coalesce(p_name_mr, ''))) < 1 or length(btrim(coalesce(p_name_en, ''))) < 1
     or length(p_name_mr) > 120 or length(p_name_en) > 120 then perform app_private.fail('NAME_REQUIRED'); end if;
  if p_status not in ('active','suspended') then perform app_private.fail('INVALID_INPUT'); end if;
  update public.shops s set name_mr = btrim(p_name_mr), name_en = btrim(p_name_en), status = p_status where s.id = p_shop_id;
  if not found then perform app_private.fail('SHOP_NOT_FOUND'); end if;
  perform app_private.audit(p_shop_id, v_uid, 'shop.updated', 'shop', p_shop_id::text,
    jsonb_build_object('name_mr', btrim(p_name_mr), 'name_en', btrim(p_name_en), 'status', p_status));
end $$;

create or replace function public.admin_update_member(p_shop_id uuid, p_user_id uuid, p_display_name text, p_role text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_admin();
  m public.shop_members;
begin
  if p_role not in ('owner','cashier') or p_status not in ('active','disabled') then perform app_private.fail('INVALID_INPUT'); end if;
  if length(btrim(coalesce(p_display_name, ''))) < 1 or length(p_display_name) > 80 then perform app_private.fail('NAME_REQUIRED'); end if;
  select * into m from public.shop_members x where x.shop_id = p_shop_id and x.user_id = p_user_id for update;
  if not found then perform app_private.fail('MEMBER_NOT_FOUND'); end if;
  if m.role = 'owner' and m.membership_status = 'active' and (p_role <> 'owner' or p_status <> 'active')
     and not exists (select 1 from public.shop_members o where o.shop_id = p_shop_id and o.user_id <> p_user_id
                     and o.role = 'owner' and o.membership_status = 'active') then
    perform app_private.fail('LAST_OWNER', 'a shop must keep at least one active owner');
  end if;
  update public.profiles p set display_name = btrim(p_display_name) where p.user_id = p_user_id;
  update public.shop_members x set role = p_role, membership_status = p_status, updated_at = now()
  where x.shop_id = p_shop_id and x.user_id = p_user_id;
  if p_status = 'disabled' then perform app_private.revoke_sessions(p_user_id); end if;
  perform app_private.audit(p_shop_id, v_uid, 'member.updated', 'user', p_user_id::text,
    jsonb_build_object('role', p_role, 'status', p_status, 'previous_role', m.role, 'previous_status', m.membership_status));
end $$;

revoke execute on function public.admin_set_shop_status(uuid, text), public.admin_list_audit(int) from authenticated;
revoke execute on function public.admin_update_shop(uuid, text, text, text), public.admin_update_member(uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.admin_update_shop(uuid, text, text, text), public.admin_update_member(uuid, uuid, text, text, text)
  to authenticated;

-- OCR.space key: stored encrypted in Supabase Vault (name `ocr_space_api_key`, added outside the
-- repo), readable only by the service role that the `ocr` edge function uses.
create or replace function public.svc_ocr_key()
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'ocr_space_api_key' order by s.created_at desc limit 1;
$$;
revoke execute on function public.svc_ocr_key() from public, anon, authenticated;
grant execute on function public.svc_ocr_key() to service_role;
