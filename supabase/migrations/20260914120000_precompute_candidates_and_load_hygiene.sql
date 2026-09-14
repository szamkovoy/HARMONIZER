-- 2026-09-14: precompute-daily-forecasts → delta-only "ensure today's cache" job.
--
-- Why: the Edge function used to (a) page through *all* active natal charts every hour
-- and (b) warm a user only in the single hour of their local midnight. One failed run
-- (gateway 504 at 21:00 UTC = 00:00 MSK on 2026-09-13) left every Moscow paid user
-- without a pre-warmed day → ~1 min live compute + LLM on first app open. At 10k paid
-- users the full-table page scan every hour would also be the dominant cost.
--
-- New contract:
--   * `precompute_daily_forecast_candidates(limit, claim, lease_minutes)` returns ONLY
--     the active paid users whose local-date cache (`user_daily_forecasts` + morning
--     `scenario_cache`) is incomplete. One indexed query; zero rows when everything is warm.
--   * Rows are leased through `daily_precompute_claims` so overlapping runs never
--     generate the same user twice; expired leases are retried automatically.
--   * `invoke_precompute_daily_forecasts()` calls the Edge function only when at least one
--     unleased candidate exists → the cron can run every 10 minutes for the price of a SELECT.
--
-- Load hygiene found in pg_stat_statements on the same audit:
--   * `sync_email_contacts_from_users` rewrote all ~15.6k `email_contacts` rows on every call
--     (12M updates total; `updated_at = now()` unconditionally). Now updates only changed rows.
--   * `cron.job_run_details` had no retention (90k rows). Daily purge, keep 7 days.

-- ---------------------------------------------------------------------------
-- A) Lease table
-- ---------------------------------------------------------------------------
create table if not exists public.daily_precompute_claims (
  user_id uuid not null references public.users(id) on delete cascade,
  local_date date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

comment on table public.daily_precompute_claims is
  'Short leases taken by precompute-daily-forecasts so concurrent/overlapping runs do not warm the same user twice. Rows older than 2 days are purged by the candidates RPC.';

alter table public.daily_precompute_claims enable row level security;
revoke all on table public.daily_precompute_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.daily_precompute_claims to service_role;

-- ---------------------------------------------------------------------------
-- B) Safe local date (mirrors resolvePrecomputeLocation: ''/UTC → Europe/Moscow)
-- ---------------------------------------------------------------------------
create or replace function public._precompute_local_date(p_tz text)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_tz text := case
    when p_tz is null or btrim(p_tz) = '' or btrim(p_tz) = 'UTC' then 'Europe/Moscow'
    else btrim(p_tz)
  end;
begin
  return (now() at time zone v_tz)::date;
exception when others then
  return (now() at time zone 'Europe/Moscow')::date;
end;
$$;

revoke all on function public._precompute_local_date(text) from public, anon, authenticated;
grant execute on function public._precompute_local_date(text) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- C) Candidates RPC (delta-only, leased)
-- ---------------------------------------------------------------------------
create or replace function public.precompute_daily_forecast_candidates(
  p_limit integer default 40,
  p_claim boolean default true,
  p_lease_minutes integer default 8,
  p_active_days integer default 5
)
returns table (
  user_id uuid,
  local_date date,
  locale text,
  needs_forecast boolean,
  needs_morning boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_active_days, 5), 1));
  v_lease interval := make_interval(mins => greatest(coalesce(p_lease_minutes, 8), 1));
  v_limit integer := greatest(coalesce(p_limit, 40), 1);
begin
  -- Housekeeping: leases are only meaningful for today/yesterday across time zones.
  delete from public.daily_precompute_claims c where c.local_date < current_date - 2;

  return query
  with base as (
    select
      u.id as user_id,
      public._precompute_local_date(u.tz) as local_date,
      case
        when lower(left(btrim(coalesce(u.locale, '')), 2)) in ('ru','en','de','fr','it','es','pt','nl')
          then lower(left(btrim(u.locale), 2))
        else 'ru'
      end as locale,
      u.last_seen_at
    from public.users u
    join public.user_natal_charts c on c.user_id = u.id and c.is_active
    where (u.last_seen_at >= v_cutoff or u.onboarded_at >= v_cutoff)
      and (
        (
          u.membership_tier in ('premium', 'oracle', 'practitioner', 'master')
          and (u.membership_expires_at is null or u.membership_expires_at > now())
        )
        or u.trial_expires_at > now()
      )
  ),
  need as (
    select
      b.user_id,
      b.local_date,
      b.locale,
      b.last_seen_at,
      not exists (
        select 1
        from public.user_daily_forecasts f
        where f.user_id = b.user_id
          and f.forecast_date = b.local_date
          and f.cache_valid_until > now()
      ) as needs_forecast,
      not exists (
        select 1
        from public.scenario_cache s
        where s.cache_key = 'morning_recommendation:' || b.user_id::text || ':'
                            || to_char(b.local_date, 'YYYY-MM-DD') || ':' || b.locale
          and s.data ? 'math_level'
          and coalesce(s.data ->> 'outputLocale', '') = b.locale
          and coalesce(btrim(s.data ->> 'slogan'), '') <> ''
          and coalesce(btrim(s.data ->> 'short_text'), '') <> ''
      ) as needs_morning
    from base b
  ),
  pending as (
    select n.*
    from need n
    where (n.needs_forecast or n.needs_morning)
      and not exists (
        select 1
        from public.daily_precompute_claims cl
        where cl.user_id = n.user_id
          and cl.local_date = n.local_date
          and cl.claimed_at > now() - v_lease
      )
    order by n.last_seen_at desc nulls last, n.user_id
    limit v_limit
  ),
  claimed as (
    insert into public.daily_precompute_claims as dc (user_id, local_date, claimed_at)
    select p.user_id, p.local_date, now()
    from pending p
    where p_claim
    on conflict (user_id, local_date) do update set claimed_at = excluded.claimed_at
    returning dc.user_id
  )
  select p.user_id, p.local_date, p.locale, p.needs_forecast, p.needs_morning
  from pending p;
end;
$$;

comment on function public.precompute_daily_forecast_candidates(integer, boolean, integer, integer) is
  'Active paid users (natal chart, seen ≤ p_active_days) whose cache for their local date is incomplete: missing/expired user_daily_forecasts or missing morning_recommendation scenario_cache in users.locale. With p_claim the returned rows are leased for p_lease_minutes.';

revoke all on function public.precompute_daily_forecast_candidates(integer, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.precompute_daily_forecast_candidates(integer, boolean, integer, integer) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- D) Invoker: SQL pre-check, call Edge only when there is work
-- ---------------------------------------------------------------------------
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
  -- Unleased candidate exists? (p_claim = false: peek only)
  if not exists (
    select 1 from public.precompute_daily_forecast_candidates(1, false)
  ) then
    return null;
  end if;

  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping precompute-daily-forecasts invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
    into v_id;

  return v_id;
end;
$function$;

revoke all on function public.invoke_precompute_daily_forecasts() from public, anon, authenticated;
grant execute on function public.invoke_precompute_daily_forecasts() to postgres, service_role;

-- ---------------------------------------------------------------------------
-- E) sync_email_contacts_from_users: only touch rows that actually change
-- ---------------------------------------------------------------------------
create or replace function public.sync_email_contacts_from_users()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  v_upserted int := 0;
begin
  insert into public.email_contacts (
    email, email_normalized, user_id, source, locale, country_code,
    marketing_status, unsubscribe_token, updated_at
  )
  select
    trim(au.email),
    lower(trim(au.email)),
    u.id,
    'app',
    coalesce(nullif(trim(u.locale), ''), 'ru'),
    u.country_code,
    'active',
    encode(extensions.gen_random_bytes(24), 'hex'),
    now()
  from auth.users au
  join public.users u on u.id = au.id
  where au.email is not null
    and trim(au.email) <> ''
    and au.email_confirmed_at is not null
  on conflict (email_normalized) do update
    set
      email = excluded.email,
      user_id = coalesce(email_contacts.user_id, excluded.user_id),
      locale = case
        when email_contacts.user_id is not null or excluded.user_id is not null
          then coalesce(nullif(trim(excluded.locale), ''), email_contacts.locale)
        else email_contacts.locale
      end,
      country_code = coalesce(excluded.country_code, email_contacts.country_code),
      source = case
        when email_contacts.source = 'imported' and excluded.user_id is not null then 'app'
        else email_contacts.source
      end,
      updated_at = now()
    -- Skip the write when nothing would change (was: 15.6k row rewrites per call).
    where email_contacts.email is distinct from excluded.email
       or email_contacts.user_id is distinct from coalesce(email_contacts.user_id, excluded.user_id)
       or email_contacts.locale is distinct from (
            case
              when email_contacts.user_id is not null or excluded.user_id is not null
                then coalesce(nullif(trim(excluded.locale), ''), email_contacts.locale)
              else email_contacts.locale
            end
          )
       or email_contacts.country_code is distinct from coalesce(excluded.country_code, email_contacts.country_code)
       or email_contacts.source is distinct from (
            case
              when email_contacts.source = 'imported' and excluded.user_id is not null then 'app'
              else email_contacts.source
            end
          );

  get diagnostics v_upserted = row_count;
  return jsonb_build_object('upserted', v_upserted, 'ran_at', now());
end;
$function$;

revoke all on function public.sync_email_contacts_from_users() from public, anon, authenticated;
grant execute on function public.sync_email_contacts_from_users() to postgres, service_role;

-- ---------------------------------------------------------------------------
-- F) cron.job_run_details retention
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_cron_job_run_details(p_keep interval default interval '7 days')
returns integer
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_deleted integer;
begin
  delete from cron.job_run_details d
  where d.end_time is not null
    and d.end_time < now() - coalesce(p_keep, interval '7 days');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_cron_job_run_details(interval) from public, anon, authenticated;
grant execute on function public.cleanup_cron_job_run_details(interval) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- G) Cron registry: precompute every 10 min (pre-checked), daily cron-log purge
-- ---------------------------------------------------------------------------
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
  -- Renamed jobs: drop the old names so they do not run twice.
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
select public.cleanup_cron_job_run_details();
