-- Daily sync: Resend suppressions → email_contacts (Vercel cron endpoint).

create or replace function public.invoke_sync_email_suppressions()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/email-suppressions-sync';
  v_id bigint;
begin
  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name in (
    'precompute_global_cron_secret',
    'notify_webinar_start_cron_secret',
    'cleanup_expired_stories_cron_secret'
  )
  order by case ds.name
    when 'precompute_global_cron_secret' then 0
    when 'notify_webinar_start_cron_secret' then 1
    else 2
  end
  limit 1;

  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping email-suppressions-sync invoke';
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

revoke all on function public.invoke_sync_email_suppressions() from public;
grant execute on function public.invoke_sync_email_suppressions() to postgres;

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
          'cleanup_unconfirmed_auth_users_hourly',
          '35 * * * *',
          'select public.cleanup_unconfirmed_auth_users();',
          'cleanup_unconfirmed_auth_users'
        ),
        (
          'cleanup_stale_notification_deliveries_weekly',
          '37 4 * * 0',
          $cmd$select public.cleanup_stale_notification_deliveries(interval '30 days', 1000, 20);$cmd$,
          'cleanup_stale_notification_deliveries'
        ),
        (
          'notify_webinar_start_minutely',
          '* * * * *',
          'select public.invoke_notify_webinar_start();',
          'invoke_notify_webinar_start'
        ),
        (
          'run_email_automations_hourly',
          '40 * * * *',
          'select public.invoke_run_email_automations();',
          'invoke_run_email_automations'
        ),
        (
          'sync_email_suppressions_daily',
          '20 5 * * *',
          'select public.invoke_sync_email_suppressions();',
          'invoke_sync_email_suppressions'
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

select public.ensure_harmonizer_cron_jobs();
