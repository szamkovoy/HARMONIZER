-- Admin dashboard pulse: geo/last_seen on users, time index on events,
-- fast RPC for /api/admin/dashboard, safer LLM token aggregation.

-- A) User analytics columns
alter table public.users
  add column if not exists country_code text
    check (country_code is null or country_code ~ '^[A-Z]{2}$');

alter table public.users
  add column if not exists city text;

alter table public.users
  add column if not exists last_seen_at timestamptz;

comment on column public.users.country_code is
  'ISO-3166-1 alpha-2 from reverse geocode of current device location.';
comment on column public.users.city is
  'City name from reverse geocode of current device location.';
comment on column public.users.last_seen_at is
  'Last app_open (throttled client-side); used for fast activity KPIs.';

create index if not exists idx_users_last_seen_at on public.users (last_seen_at desc nulls last);
create index if not exists idx_users_country_code on public.users (country_code);
create index if not exists idx_users_created_at on public.users (created_at);

-- B) Time-leading index for event-window scans (DAU series, LLM windows)
create index if not exists idx_user_event_log_occurred_at
  on public.user_event_log (occurred_at desc);

create index if not exists idx_user_event_log_kind_occurred_at
  on public.user_event_log (kind, occurred_at desc);

-- C) Fix LLM token sum: prefer total_tokens (avoid double-counting parts + total)
create or replace function public.admin_llm_metrics(p_window interval)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'dialog_turns', count(*) filter (where kind = 'dialog_turn'),
    'avg_latency_ms', round(avg(
      case when kind = 'dialog_turn' then nullif(payload->>'latency_ms', '')::numeric end)),
    'p95_latency_ms', round((percentile_cont(0.95) within group (
      order by case when kind = 'dialog_turn' then nullif(payload->>'latency_ms', '')::numeric end))::numeric),
    'llm_errors', count(*) filter (where kind = 'llm_error'),
    'llm_timeouts', count(*) filter (where kind = 'llm_timeout'),
    'api_errors', count(*) filter (where kind = 'api_error'),
    'prompt_events', count(*) filter (where kind = 'llm_prompt_size'),
    'prompt_tokens', (
      select coalesce(sum(
        case
          when e.payload ? 'total_tokens'
            and nullif(e.payload->>'total_tokens', '') ~ '^[0-9]+(\.[0-9]+)?$'
            then (e.payload->>'total_tokens')::numeric
          else coalesce((
            select sum(v.value::numeric)
            from jsonb_each_text(e.payload) v
            where v.key like '%\_tokens' escape '\'
              and v.key <> 'total_tokens'
              and v.value ~ '^[0-9]+(\.[0-9]+)?$'
          ), 0)
        end
      ), 0)
      from public.user_event_log e
      where e.kind = 'llm_prompt_size'
        and e.occurred_at > now() - p_window
    )
  )
  from public.user_event_log
  where occurred_at > now() - p_window
    and kind in ('dialog_turn', 'llm_error', 'llm_timeout', 'llm_prompt_size', 'api_error');
$$;

-- D) Access segment helper expression via SQL function
create or replace function public.admin_user_access_segment(
  p_tier text,
  p_membership_expires_at timestamptz,
  p_trial_expires_at timestamptz
)
returns text
language sql
stable
as $$
  select case
    when p_trial_expires_at is not null and p_trial_expires_at > now() then 'trial'
    when p_tier = 'master'
      and (p_membership_expires_at is null or p_membership_expires_at > now()) then 'master'
    when p_tier in ('oracle', 'practitioner')
      and (p_membership_expires_at is null or p_membership_expires_at > now()) then 'oracle'
    else 'navigator'
  end;
$$;

-- E) Main pulse RPC
create or replace function public.admin_dashboard_pulse(
  p_days int default 30,
  p_grain text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 366));
  v_grain text := case when lower(coalesce(p_grain, 'day')) = 'week' then 'week' else 'day' end;
  v_since timestamptz := now() - make_interval(days => v_days);
  v_prev_since timestamptz := now() - make_interval(days => v_days * 2);
  v_result jsonb;
begin
  with access_now as (
    select
      count(*) filter (where seg = 'navigator') as navigator,
      count(*) filter (where seg = 'trial') as trial,
      count(*) filter (where seg = 'oracle') as oracle,
      count(*) filter (where seg = 'master') as master
    from (
      select public.admin_user_access_segment(
        membership_tier, membership_expires_at, trial_expires_at
      ) as seg
      from public.users
    ) s
  ),
  reg_days as (
    select
      case
        when v_grain = 'week' then (date_trunc('week', created_at at time zone 'UTC'))::date
        else (created_at at time zone 'UTC')::date
      end as bucket,
      count(*)::int as count
    from public.users
    where created_at >= v_since
    group by 1
    order by 1
  ),
  active_days as (
    select
      case
        when v_grain = 'week' then (date_trunc('week', occurred_at at time zone 'UTC'))::date
        else (occurred_at at time zone 'UTC')::date
      end as bucket,
      count(distinct user_id)::int as count
    from public.user_event_log
    where occurred_at >= v_since
    group by 1
    order by 1
  ),
  lava_period as (
    select
      currency,
      coalesce(sum(amount), 0)::numeric as sum,
      count(*)::int as count
    from public.payment_contracts
    where status in ('active', 'cancelled')
      and created_at >= v_since
      and amount is not null
    group by currency
  ),
  lava_days as (
    select
      case
        when v_grain = 'week' then (date_trunc('week', created_at at time zone 'UTC'))::date
        else (created_at at time zone 'UTC')::date
      end as bucket,
      currency,
      coalesce(sum(amount), 0)::numeric as sum,
      count(*)::int as count
    from public.payment_contracts
    where status in ('active', 'cancelled')
      and created_at >= v_since
      and amount is not null
    group by 1, 2
    order by 1
  ),
  lava_by_tier as (
    select
      tier,
      coalesce(sum(amount), 0)::numeric as sum,
      count(*)::int as count
    from public.payment_contracts
    where status in ('active', 'cancelled')
      and created_at >= v_since
      and amount is not null
    group by tier
  ),
  grants_period as (
    select
      coalesce(sum(amount), 0)::numeric as sum,
      count(*)::int as count
    from public.payments
    where source = 'manual'
      and created_at >= v_since
  ),
  geo as (
    select
      country_code as code,
      count(*)::int as count
    from public.users
    where country_code is not null
    group by country_code
    order by count desc, country_code
    limit 30
  ),
  top_tokens as (
    select
      e.user_id,
      u.display_name,
      coalesce(sum(
        case
          when e.payload ? 'total_tokens'
            and nullif(e.payload->>'total_tokens', '') ~ '^[0-9]+(\.[0-9]+)?$'
            then (e.payload->>'total_tokens')::numeric
          else 0
        end
      ), 0)::numeric as tokens
    from public.user_event_log e
    left join public.users u on u.id = e.user_id
    where e.kind = 'llm_prompt_size'
      and e.occurred_at > now() - interval '1 day'
    group by e.user_id, u.display_name
    having coalesce(sum(
      case
        when e.payload ? 'total_tokens'
          and nullif(e.payload->>'total_tokens', '') ~ '^[0-9]+(\.[0-9]+)?$'
          then (e.payload->>'total_tokens')::numeric
        else 0
      end
    ), 0) > 0
    order by tokens desc
    limit 10
  ),
  llm_24h as (
    select public.admin_llm_metrics(interval '1 day') as m
  ),
  llm_period as (
    select public.admin_llm_metrics(make_interval(days => v_days)) as m
  )
  select jsonb_build_object(
    'generated_at', now(),
    'range_days', v_days,
    'grain', v_grain,
    'kpi', jsonb_build_object(
      'users_total', (select count(*) from public.users),
      'reg_today', (select count(*) from public.users
        where created_at >= date_trunc('day', now())),
      'reg_yesterday', (select count(*) from public.users
        where created_at >= date_trunc('day', now()) - interval '1 day'
          and created_at < date_trunc('day', now())),
      'reg_day_before', (select count(*) from public.users
        where created_at >= date_trunc('day', now()) - interval '2 day'
          and created_at < date_trunc('day', now()) - interval '1 day'),
      'reg_period', (select count(*) from public.users where created_at >= v_since),
      'reg_prev_period', (select count(*) from public.users
        where created_at >= v_prev_since and created_at < v_since),
      'active_24h', (select count(*) from public.users
        where last_seen_at > now() - interval '1 day'
           or id in (select distinct user_id from public.user_event_log
                     where occurred_at > now() - interval '1 day')),
      'active_7d', (select count(*) from public.users
        where last_seen_at > now() - interval '7 days'
           or id in (select distinct user_id from public.user_event_log
                     where occurred_at > now() - interval '7 days')),
      'access_now', (select jsonb_build_object(
        'navigator', navigator, 'trial', trial, 'oracle', oracle, 'master', master
      ) from access_now),
      'revenue_lava', coalesce((
        select jsonb_agg(jsonb_build_object('currency', currency, 'sum', sum, 'count', count))
        from lava_period
      ), '[]'::jsonb),
      'grants_manual', (select jsonb_build_object('sum', sum, 'count', count) from grants_period)
    ),
    'series', jsonb_build_object(
      'registrations', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', count) order by bucket)
        from reg_days
      ), '[]'::jsonb),
      'active_users', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', count) order by bucket)
        from active_days
      ), '[]'::jsonb),
      'revenue', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bucket', bucket, 'currency', currency, 'sum', sum, 'count', count
        ) order by bucket)
        from lava_days
      ), '[]'::jsonb)
    ),
    'revenue_by_tier', coalesce((
      select jsonb_agg(jsonb_build_object('tier', tier, 'sum', sum, 'count', count))
      from lava_by_tier
    ), '[]'::jsonb),
    'load', jsonb_build_object(
      'llm_24h', (select m from llm_24h),
      'llm_period', (select m from llm_period),
      'top_users_tokens_24h', coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', user_id,
          'display_name', display_name,
          'tokens', tokens
        ))
        from top_tokens
      ), '[]'::jsonb)
    ),
    'geo', jsonb_build_object(
      'by_country', coalesce((
        select jsonb_agg(jsonb_build_object('code', code, 'count', count))
        from geo
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_user_access_segment(text, timestamptz, timestamptz) from public;
revoke execute on function public.admin_user_access_segment(text, timestamptz, timestamptz) from anon;
revoke execute on function public.admin_user_access_segment(text, timestamptz, timestamptz) from authenticated;
revoke execute on function public.admin_dashboard_pulse(int, text) from public;
revoke execute on function public.admin_dashboard_pulse(int, text) from anon;
revoke execute on function public.admin_dashboard_pulse(int, text) from authenticated;
