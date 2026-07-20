-- Self-healing registry for HARMONIZER pg_cron jobs.
--
-- Why: paid precompute (`precompute_daily_forecasts_hourly`) historically lived
-- only in DEPLOY.md / README (manual `cron.schedule`) and never had a migration,
-- so production could run for months without the paid warm job. Membership
-- reconcile also disappeared from cron.job after restores/manual edits.
--
-- Fix: `ensure_harmonizer_cron_jobs()` is the single source of truth for job
-- names + schedules. It unschedule/re-schedules any missing/inactive/mismatched
-- job. Invoked:
--   1) at the end of this migration
--   2) every 15 minutes via watchdog cron itself
--   3) at the start of free + paid precompute invokers (belt-and-suspenders)
--
-- Requires: vault secret `precompute_global_cron_secret` (= Edge CRON_SECRET).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.ensure_harmonizer_cron_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, cron, extensions
as $function$
declare
  repaired text[] := '{}';
  missing_invokers text[] := '{}';
  req record;
  stale record;
  invoker_name text;
  schedule_ok boolean;
begin
  for req in
    select *
    from (
      values
        (
          'precompute_global_recommendations_hourly',
          '0 * * * *',
          'select public.invoke_precompute_global_recommendations();',
          'invoke_precompute_global_recommendations'
        ),
        (
          'precompute_daily_forecasts_hourly',
          '0 * * * *',
          'select public.invoke_precompute_daily_forecasts();',
          'invoke_precompute_daily_forecasts'
        ),
        (
          'cleanup_expired_stories_hourly',
          '15 * * * *',
          'select public.invoke_cleanup_expired_stories();',
          'invoke_cleanup_expired_stories'
        ),
        (
          'reconcile_expired_memberships_hourly',
          '20 * * * *',
          'select public.invoke_reconcile_expired_memberships();',
          'invoke_reconcile_expired_memberships'
        ),
        (
          'ensure_harmonizer_crons_watchdog',
          '*/15 * * * *',
          'select public.ensure_harmonizer_cron_jobs();',
          'ensure_harmonizer_cron_jobs'
        )
    ) as t(jobname, schedule, command, invoker)
  loop
    invoker_name := req.invoker;

    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = invoker_name
    ) then
      missing_invokers := array_append(missing_invokers, req.jobname);
      raise warning '[ensure_harmonizer_cron_jobs] invoker missing for % (%)',
        req.jobname, invoker_name;
      continue;
    end if;

    select exists (
      select 1
      from cron.job cj
      where cj.jobname = req.jobname
        and cj.schedule = req.schedule
        and btrim(cj.command) = btrim(req.command)
        and cj.active
    )
      into schedule_ok;

    if schedule_ok then
      continue;
    end if;

    for stale in
      select cj.jobid
      from cron.job cj
      where cj.jobname = req.jobname
    loop
      perform cron.unschedule(stale.jobid);
    end loop;

    perform cron.schedule(req.jobname, req.schedule, req.command);
    repaired := array_append(repaired, req.jobname);
    raise warning '[ensure_harmonizer_cron_jobs] repaired schedule % (%)',
      req.jobname, req.schedule;
  end loop;

  return jsonb_build_object(
    'ok', coalesce(array_length(missing_invokers, 1), 0) = 0,
    'repaired', to_jsonb(coalesce(repaired, '{}'::text[])),
    'missing_invokers', to_jsonb(coalesce(missing_invokers, '{}'::text[])),
    'checked_at', now()
  );
end;
$function$;

revoke all on function public.ensure_harmonizer_cron_jobs() from public;
grant execute on function public.ensure_harmonizer_cron_jobs() to postgres;

-- Belt-and-suspenders: every hourly warm also re-asserts the registry
-- (covers the case where the 15-min watchdog itself was dropped).
create or replace function public.invoke_precompute_global_recommendations()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/precompute-global-recommendations';
  v_id bigint;
begin
  perform public.ensure_harmonizer_cron_jobs();

  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'precompute_global_cron_secret'
  limit 1;

  if v_secret is null then
    raise warning 'Vault secret "precompute_global_cron_secret" is missing; skipping precompute-global-recommendations invoke';
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
  perform public.ensure_harmonizer_cron_jobs();

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

revoke all on function public.invoke_precompute_global_recommendations() from public;
revoke all on function public.invoke_precompute_daily_forecasts() from public;
grant execute on function public.invoke_precompute_global_recommendations() to postgres;
grant execute on function public.invoke_precompute_daily_forecasts() to postgres;

-- Immediate repair on apply (also seeds the watchdog job itself).
select public.ensure_harmonizer_cron_jobs();
