-- 30 days of a tier without auto-renewal: sold after a subscription payment fails.
-- failure_reason: why Lava / YooKassa declined the first payment.
-- pass_reminder_sent_at: the one letter sent shortly before those 30 days end.

alter table public.payment_contracts
  add column if not exists failure_reason text,
  add column if not exists pass_reminder_sent_at timestamptz;

comment on column public.payment_contracts.failure_reason is
  'Provider decline reason for a failed first payment (Lava errorMessage, YooKassa party:reason).';
comment on column public.payment_contracts.pass_reminder_sent_at is
  'One-time 30-day tier: when the renewal reminder letter was claimed/sent.';

-- One-time Lava products «Гармонизатор (тариф Наставник/Мастер)», same prices as the subscription.
insert into public.payment_offers (tier, locale, offer_id, active)
values
  ('oracle_30d', 'en', '8df24276-c186-4637-a89a-3e4bf85bc0b6', true),
  ('master_30d', 'en', 'dba6b70c-8222-4cf6-b5e8-6c725132e994', true)
on conflict (tier, locale) do update
  set offer_id = excluded.offer_id,
      active = true,
      updated_at = now();

-- Daily, only when some paid 30 days end within 3 days and the letter is not sent yet.
create or replace function public.invoke_send_pass_reminders()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/pass-reminders';
  v_id bigint;
begin
  if not exists (
    select 1
    from public.payment_contracts
    where product_kind = 'one_time'
      and tier in ('oracle', 'master')
      and status = 'active'
      and pass_reminder_sent_at is null
      and current_period_end > now()
      and current_period_end <= now() + interval '3 days'
  ) then
    return null;
  end if;

  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping pass-reminders invoke';
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

revoke all on function public.invoke_send_pass_reminders() from public, anon, authenticated;
grant execute on function public.invoke_send_pass_reminders() to postgres, service_role;

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
      'webinar_pass_emails_every_5m'
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
          'send_pass_reminders_daily',
          '30 9 * * *',
          'select public.invoke_send_pass_reminders();',
          'invoke_send_pass_reminders'
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
