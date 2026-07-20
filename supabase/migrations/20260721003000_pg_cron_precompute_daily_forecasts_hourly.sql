-- Hourly pg_cron: invoke Edge Function `precompute-daily-forecasts`.
-- The Edge function itself only spends LLM budget for users whose local hour is 0
-- (and who have recent activity + personal-forecast access). Without this job the
-- paid midnight path never gets pre-warmed `user_daily_forecasts` / scenario_cache.
--
-- Reuses vault secret `precompute_global_cron_secret` (same value as Edge CRON_SECRET).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_precompute_daily_forecasts()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/precompute-daily-forecasts';
  v_id bigint;
begin
  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'precompute_global_cron_secret'
  limit 1;

  if v_secret is null then
    raise warning 'Vault secret "precompute_global_cron_secret" is missing; skipping precompute-daily-forecasts invoke';
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

revoke all on function public.invoke_precompute_daily_forecasts() from public;
grant execute on function public.invoke_precompute_daily_forecasts() to postgres;

do $do$
declare
  r record;
begin
  for r in
    select j.jobid
    from cron.job j
    where j.jobname in (
      'precompute_daily_forecasts_hourly',
      'precompute_daily_forecasts_daily'
    )
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$do$;

select cron.schedule(
  'precompute_daily_forecasts_hourly',
  '0 * * * *',
  $$select public.invoke_precompute_daily_forecasts();$$
);
