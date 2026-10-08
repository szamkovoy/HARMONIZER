-- Webinar letters are sent when a webinar is published or a purchase lands.
-- The 5-minute pass scan and the reminder letter are removed: the watchdog
-- must not put those jobs back.

create table if not exists public.webinar_notice_sends (
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null check (kind in ('invite', 'recording')),
  locale     text not null,
  sent_at    timestamptz not null default now(),
  primary key (webinar_id, user_id, kind)
);

comment on table public.webinar_notice_sends is
  'One invite or recording letter per person per webinar. Service role only.';

alter table public.webinar_notice_sends enable row level security;

create or replace function public.emails_for_user_ids(p_ids uuid[])
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = auth, public
as $$
  select u.id, u.email::text
  from auth.users u
  where u.id = any (p_ids)
    and u.email is not null;
$$;

revoke all on function public.emails_for_user_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.emails_for_user_ids(uuid[]) to service_role;

drop function if exists public.invoke_webinar_pass_emails();

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
