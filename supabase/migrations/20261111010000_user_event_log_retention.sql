-- Retention for user_event_log. The table had no cleanup and grew monotonically.
-- Different kinds need different windows:
--   • dialog_turn, llm_prompt_size, llm_error, llm_timeout, api_error — 90 days
--     (admin pulse only reads LLM metrics up to 90 days; `range=all` uses
--      users.created_at and payment_contracts, not this log).
--   • app_open — 365 days (DAU/WAU/MAU history; pulse reads 7/30/90d windows).
--   • practice_selected, calibration_suggested — kept (low volume, product
--     insight).
-- Runs inside Postgres via pg_cron once a day at 03:30 MSK (00:30 UTC), in
-- batches of 10 000 rows so a long transaction never holds locks or trips
-- statement_timeout. No Vercel involvement.

create or replace function public.cleanup_old_user_event_log(
  p_batch_limit int default 10000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
  v_round int;
  v_cutoff_dialog timestamptz := now() - interval '90 days';
  v_cutoff_app_open timestamptz := now() - interval '365 days';
begin
  if p_batch_limit is null or p_batch_limit <= 0 then
    p_batch_limit := 10000;
  end if;
  loop
    delete from public.user_event_log
    where id in (
      select id
      from public.user_event_log
      where (
        kind in ('dialog_turn', 'llm_prompt_size', 'llm_error', 'llm_timeout', 'api_error')
          and occurred_at < v_cutoff_dialog
      ) or (
        kind = 'app_open' and occurred_at < v_cutoff_app_open
      )
      order by occurred_at
      limit p_batch_limit
      for update skip locked
    );
    get diagnostics v_round = row_count;
    v_deleted := v_deleted + v_round;
    if v_round < p_batch_limit then
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'deleted', v_deleted,
    'cutoff_dialog', v_cutoff_dialog,
    'cutoff_app_open', v_cutoff_app_open,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.cleanup_old_user_event_log(int) from public, anon, authenticated;
grant execute on function public.cleanup_old_user_event_log(int) to postgres, service_role;

-- Register in the cron registry so the watchdog keeps the schedule aligned.
create or replace function public.ensure_harmonizer_cron_jobs()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'cron', 'extensions'
as $function$
declare
  repaired text[] := '{}';
  missing_invokers text[] := '{}';
  req record;
  stale record;
  invoker_name text;
  schedule_ok boolean;
begin
  for stale in
    select cj.jobid from cron.job cj where cj.jobname in (
      'precompute_daily_forecasts_hourly',
      'apply_webinar_passes_every_5m',
      'webinar_pass_emails_every_5m',
      'send_pass_reminders_daily'
    )
  loop
    perform cron.unschedule(stale.jobid);
  end loop;

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
          'precompute_daily_forecasts_every_10m',
          '*/10 * * * *',
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
          'run_email_automations_every_5m',
          '*/5 * * * *',
          'select public.invoke_run_email_automations();',
          'invoke_run_email_automations'
        ),
        (
          'run_email_campaigns_every_5m',
          '*/5 * * * *',
          'select public.invoke_run_email_campaigns();',
          'invoke_run_email_campaigns'
        ),
        (
          'sync_email_suppressions_daily',
          '20 5 * * *',
          'select public.invoke_sync_email_suppressions();',
          'invoke_sync_email_suppressions'
        ),
        (
          'run_yookassa_renewals_daily',
          '15 3 * * *',
          'select public.invoke_run_yookassa_renewals();',
          'invoke_run_yookassa_renewals'
        ),
        (
          'cleanup_daily_dialog_archives_hourly',
          '50 * * * *',
          'select public.cleanup_daily_dialog_archives();',
          'cleanup_daily_dialog_archives'
        ),
        (
          'cleanup_cron_job_run_details_daily',
          '40 4 * * *',
          'select public.cleanup_cron_job_run_details();',
          'cleanup_cron_job_run_details'
        ),
        (
          'reconcile_lava_payments_every_10m',
          '*/10 * * * *',
          'select public.invoke_reconcile_lava_payments();',
          'invoke_reconcile_lava_payments'
        ),
        (
          'send_pass_reminders_hourly',
          '45 * * * *',
          'select public.invoke_send_pass_reminders();',
          'invoke_send_pass_reminders'
        ),
        (
          'cleanup_old_user_event_log_daily',
          '30 0 * * *',
          $cmd$select public.cleanup_old_user_event_log(10000);$cmd$,
          'cleanup_old_user_event_log'
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

revoke all on function public.ensure_harmonizer_cron_jobs() from public, anon, authenticated;
grant execute on function public.ensure_harmonizer_cron_jobs() to postgres, service_role;

select public.ensure_harmonizer_cron_jobs();
