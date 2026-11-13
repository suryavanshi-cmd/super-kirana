-- Server functions read the Sarvam key from the encrypted Vault (secret name: sarvam_api_key);
-- browsers can never call this. The key itself is stored with vault.create_secret, never in the repo.
create or replace function public.svc_sarvam_key()
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'sarvam_api_key' order by s.created_at desc limit 1;
$$;
revoke execute on function public.svc_sarvam_key() from public, anon, authenticated;
grant execute on function public.svc_sarvam_key() to service_role;
