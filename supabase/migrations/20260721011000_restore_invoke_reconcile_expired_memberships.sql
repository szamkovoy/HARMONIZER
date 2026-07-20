-- Prod lost `invoke_reconcile_expired_memberships` (function gone, cron job gone).
-- Watchdog `ensure_harmonizer_cron_jobs()` cannot reschedule until the invoker exists.
-- Re-create invoker (same body as 20260710023000) and re-assert the registry.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_reconcile_expired_memberships()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/reconcile-expired-memberships';
  v_id bigint;
begin
  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'reconcile_expired_memberships_cron_secret'
  limit 1;

  if v_secret is null then
    raise warning 'Vault secret "reconcile_expired_memberships_cron_secret" is missing; skipping reconcile-expired-memberships invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  )
    into v_id;

  return v_id;
end;
$function$;

revoke all on function public.invoke_reconcile_expired_memberships() from public;
grant execute on function public.invoke_reconcile_expired_memberships() to postgres;

select public.ensure_harmonizer_cron_jobs();
