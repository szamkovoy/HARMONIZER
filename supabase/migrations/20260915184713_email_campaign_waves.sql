-- Campaign warmup waves: pause/edit between batches, skip already-accepted
-- recipients, lease so Vercel 300s invokers do not overlap.

alter table public.email_campaigns
  drop constraint if exists email_campaigns_status_check;

alter table public.email_campaigns
  add constraint email_campaigns_status_check
  check (status in ('draft', 'sending', 'paused', 'sent', 'failed'));

alter table public.email_campaigns
  add column if not exists warmup_plan jsonb not null default jsonb_build_object(
    'sizes', jsonb_build_array(500, 500, 1000, 1000, 2000, 2000, 3000),
    'repeat_last', true,
    'hour_msk', 16
  ),
  add column if not exists warmup_wave_index int not null default 0,
  add column if not exists next_wave_at timestamptz,
  add column if not exists next_wave_size int,
  add column if not exists audience_cap int,
  add column if not exists send_halted_at timestamptz,
  add column if not exists send_lease_until timestamptz;

comment on column public.email_campaigns.warmup_plan is
  'sizes[], repeat_last, hour_msk. After a wave, next_wave_at is the next 16:00 Europe/Moscow (or +24h).';
comment on column public.email_campaigns.audience_cap is
  'If set, only the N most recently active eligible contacts ever receive this campaign.';
comment on column public.email_campaigns.send_halted_at is
  'Admin stop. Queued leftover is not drained until resume.';
comment on column public.email_campaigns.send_lease_until is
  'Exclusive send worker lease; expired lease may be stolen after a crashed invoker.';

create index if not exists email_campaigns_send_due_idx
  on public.email_campaigns (status, next_wave_at)
  where status in ('sending', 'paused');

create index if not exists email_campaign_sends_queued_idx
  on public.email_campaign_sends (campaign_id)
  where status = 'queued';

create or replace function public.try_lock_email_campaign_send(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.email_campaigns
  set
    send_lease_until = now() + interval '6 minutes',
    updated_at = now()
  where id = p_id
    and (send_lease_until is null or send_lease_until < now())
    and send_halted_at is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create or replace function public.unlock_email_campaign_send(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_campaigns
  set send_lease_until = null, updated_at = now()
  where id = p_id;
$$;

revoke all on function public.try_lock_email_campaign_send(uuid) from public, anon, authenticated;
revoke all on function public.unlock_email_campaign_send(uuid) from public, anon, authenticated;
grant execute on function public.try_lock_email_campaign_send(uuid) to service_role;
grant execute on function public.unlock_email_campaign_send(uuid) to service_role;

create or replace function public.invoke_run_email_campaigns()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/email-campaigns';
  v_id bigint;
  v_due boolean;
begin
  select exists (
    select 1
    from public.email_campaigns c
    where c.send_halted_at is null
      and (c.send_lease_until is null or c.send_lease_until < now())
      and (
        c.status = 'sending'
        or (
          c.status = 'paused'
          and c.next_wave_at is not null
          and c.next_wave_at <= now()
        )
      )
  ) into v_due;
  if not v_due then
    return null;
  end if;

  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping email-campaigns invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  )
    into v_id;

  return v_id;
end;
$function$;

revoke all on function public.invoke_run_email_campaigns() from public, anon, authenticated;
grant execute on function public.invoke_run_email_campaigns() to postgres, service_role;

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
    select cj.jobid from cron.job cj where cj.jobname in ('precompute_daily_forecasts_hourly')
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

update public.email_campaigns
set
  warmup_plan = jsonb_build_object(
    'sizes', jsonb_build_array(500, 500, 1000, 1000, 2000, 2000, 3000),
    'repeat_last', true,
    'hour_msk', 16
  ),
  warmup_wave_index = 0,
  next_wave_size = 500,
  audience_cap = null,
  updated_at = now()
where id = 'bbee12ab-53b7-4bce-b17c-42252e1419c5';
