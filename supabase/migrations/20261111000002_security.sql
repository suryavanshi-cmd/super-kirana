-- Authorization helpers, immutability, balance cache, Row Level Security.

-- ---------------------------------------------------------------- helpers
create or replace function app_private.fail(p_code text, p_detail text default null)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end $$;

create or replace function app_private.is_admin(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = p_uid);
$$;

-- Effective role of the calling user in a shop, or null when they have no access.
-- Membership, shop status and the forced-password-change flag are read live on every call, so a
-- disabled cashier loses access immediately even while holding an unexpired session token.
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
  if app_private.is_admin(v_uid) then
    if exists (select 1 from public.shops s where s.id = p_shop_id) then return 'owner'; end if;
    return null;
  end if;
  select m.role into v_role
  from public.shop_members m join public.shops s on s.id = m.shop_id
  where m.shop_id = p_shop_id and m.user_id = v_uid
    and m.membership_status = 'active' and s.status = 'active';
  return v_role;
end $$;

create or replace function app_private.has_shop_access(p_shop_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.shop_role(p_shop_id) is not null;
$$;

create or replace function app_private.require_role(p_shop_id uuid, p_min text, p_write boolean default false)
returns text language plpgsql stable security definer set search_path = '' as $$
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
  return v_role;
end $$;

create or replace function app_private.shop_today(p_shop_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone s.timezone)::date from public.shops s where s.id = p_shop_id;
$$;

create or replace function app_private.audit(p_shop uuid, p_actor uuid, p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events(shop_id, actor_id, action, entity_type, entity_id, details)
  values (p_shop, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------- immutability
create or replace function app_private.deny_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD',
    detail = tg_table_name || ' rows cannot be ' || lower(tg_op) || 'd';
end $$;

-- Posted documents may only move posted -> reversed; every other column is frozen.
create or replace function app_private.guard_document()
returns trigger language plpgsql set search_path = '' as $$
declare
  k text[] := array['status','reversed_at','reversed_by','reversal_reason'];
begin
  if old.status <> 'posted' or new.status <> 'reversed' or (to_jsonb(new) - k) <> (to_jsonb(old) - k) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD',
      detail = tg_table_name || ' is posted and can only be reversed';
  end if;
  return new;
end $$;

create or replace function app_private.guard_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.result is not null or (to_jsonb(new) - array['result','completed_at']) <> (to_jsonb(old) - array['result','completed_at']) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD', detail = 'client_mutations';
  end if;
  return new;
end $$;

create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function app_private.deny_change();
create trigger invoice_items_immutable before update or delete on public.invoice_items
  for each row execute function app_private.deny_change();
create trigger payment_allocations_immutable before update or delete on public.payment_allocations
  for each row execute function app_private.deny_change();
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function app_private.deny_change();

create trigger invoices_guard before update on public.invoices
  for each row execute function app_private.guard_document();
create trigger invoices_no_delete before delete on public.invoices
  for each row execute function app_private.deny_change();
create trigger payments_guard before update on public.payments
  for each row execute function app_private.guard_document();
create trigger payments_no_delete before delete on public.payments
  for each row execute function app_private.deny_change();
create trigger credit_notes_guard before update on public.credit_notes
  for each row execute function app_private.guard_document();
create trigger credit_notes_no_delete before delete on public.credit_notes
  for each row execute function app_private.deny_change();
create trigger client_mutations_guard before update on public.client_mutations
  for each row execute function app_private.guard_mutation();
create trigger client_mutations_no_delete before delete on public.client_mutations
  for each row execute function app_private.deny_change();

-- ---------------------------------------------------------------- balance cache
create or replace function app_private.apply_ledger_to_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is not null then
    insert into public.customer_balances(customer_id, shop_id, balance_paise)
    values (new.customer_id, new.shop_id, new.amount_paise)
    on conflict (customer_id) do update
      set balance_paise = public.customer_balances.balance_paise + excluded.balance_paise, updated_at = now();
  end if;
  return null;
end $$;
create trigger ledger_entries_balance after insert on public.ledger_entries
  for each row execute function app_private.apply_ledger_to_balance();

-- Checked at COMMIT against the final row, so a transaction may pass through intermediate states
-- but can never leave a customer with a negative (hidden advance) balance.
create or replace function app_private.check_balance_not_negative()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v bigint;
begin
  select b.balance_paise into v from public.customer_balances b where b.customer_id = new.customer_id;
  if v < 0 then
    raise exception using errcode = 'P0001', message = 'NEGATIVE_BALANCE',
      detail = 'customer balance would become negative';
  end if;
  return null;
end $$;
create constraint trigger customer_balances_not_negative after insert or update on public.customer_balances
  deferrable initially deferred for each row execute function app_private.check_balance_not_negative();

-- ---------------------------------------------------------------- row level security
alter table public.shops enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.shop_members enable row level security;
alter table public.customers enable row level security;
alter table public.customer_balances enable row level security;
alter table public.products enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.credit_notes enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.ocr_jobs enable row level security;
alter table public.audit_events enable row level security;
alter table public.client_mutations enable row level security;
alter table public.auth_throttle enable row level security;
alter table public.platform_setup enable row level security;

-- Read-only policies. There are deliberately NO insert/update/delete policies: every write goes
-- through a security-definer function that re-checks membership and role.
create policy shops_select on public.shops for select to authenticated
  using (app_private.has_shop_access(id));
create policy profiles_select_self on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy platform_admins_select_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));
create policy shop_members_select on public.shop_members for select to authenticated
  using (user_id = (select auth.uid()) or app_private.shop_role(shop_id) = 'owner');
create policy customers_select on public.customers for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy customer_balances_select on public.customer_balances for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy products_select on public.products for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy invoices_select on public.invoices for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy invoice_items_select on public.invoice_items for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy payments_select on public.payments for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy credit_notes_select on public.credit_notes for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy ocr_jobs_select on public.ocr_jobs for select to authenticated
  using (app_private.has_shop_access(shop_id));
create policy audit_events_select on public.audit_events for select to authenticated
  using (shop_id is not null and app_private.shop_role(shop_id) = 'owner');
create policy client_mutations_select on public.client_mutations for select to authenticated
  using (user_id = (select auth.uid()) and app_private.has_shop_access(shop_id));

-- Table privileges: browsers get SELECT only (filtered by the policies above); anon gets nothing.
revoke all on all tables in schema public from anon, authenticated;
grant select on
  public.shops, public.profiles, public.platform_admins, public.shop_members, public.customers,
  public.customer_balances, public.products, public.invoices, public.invoice_items, public.payments,
  public.credit_notes, public.payment_allocations, public.ledger_entries, public.ocr_jobs,
  public.audit_events, public.client_mutations
to authenticated;

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.has_shop_access(uuid), app_private.shop_role(uuid) to authenticated;

-- Functions created later must not be callable by anon/public unless granted explicitly.
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;
