-- Ask Lava only when a pending invoice is 10–22 minutes old.
-- No matching row: do not call the app at all.

create or replace function public.invoke_reconcile_lava_payments()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/lava-reconcile';
  v_id bigint;
begin
  if not exists (
    select 1
    from public.payment_contracts
    where provider = 'lavatop'
      and status = 'pending'
      and created_at <= now() - interval '10 minutes'
      and created_at >= now() - interval '22 minutes'
  ) then
    return null;
  end if;

  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping lava-reconcile invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
    into v_id;

  return v_id;
end;
$function$;

revoke all on function public.invoke_reconcile_lava_payments() from public, anon, authenticated;
grant execute on function public.invoke_reconcile_lava_payments() to postgres, service_role;
