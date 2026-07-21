-- Dashboard pulse v2: geo backfill, period geo, conversions, token series, all-time days.

-- Backfill ISO country from free-text location_name (RU projects historically).
update public.users
set country_code = 'RU'
where country_code is null
  and location_name is not null
  and (
    location_name ilike '%Россия%'
    or location_name ilike '%Russia%'
    or location_name ilike '%, RU'
    or location_name ilike '% РФ%'
  );

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
  -- 0 / null → «всё время» (с первого пользователя, max 10 лет).
  v_days int;
  v_grain text;
  v_since timestamptz;
  v_prev_since timestamptz;
  v_result jsonb;
  v_first timestamptz;
begin
  if p_days is null or p_days <= 0 then
    select coalesce(min(created_at), now()) into v_first from public.users;
    v_days := greatest(1, least(ceil(extract(epoch from (now() - v_first)) / 86400.0)::int, 3650));
  else
    v_days := greatest(1, least(p_days, 3650));
  end if;

  v_grain := case when lower(coalesce(p_grain, 'day')) = 'week' then 'week' else 'day' end;
  -- «Всё время» всегда неделями (защита от тысяч дневных строк).
  if p_days is null or p_days <= 0 then
    v_grain := 'week';
  end if;

  v_since := now() - make_interval(days => v_days);
  v_prev_since := now() - make_interval(days => v_days * 2);

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
  cohort as (
    select
      id,
      public.admin_user_access_segment(
        membership_tier, membership_expires_at, trial_expires_at
      ) as seg
    from public.users
    where created_at >= v_since
  ),
  cohort_counts as (
    select
      count(*)::int as reg_total,
      count(*) filter (where seg = 'navigator')::int as to_navigator,
      count(*) filter (where seg = 'trial')::int as to_trial,
      count(*) filter (where seg = 'oracle')::int as to_oracle,
      count(*) filter (where seg = 'master')::int as to_master
    from cohort
  ),
  sub_payments as (
    select
      user_id,
      created_at,
      row_number() over (partition by user_id order by created_at) as n
    from public.payment_contracts
    where product_kind = 'subscription'
      and tier in ('oracle', 'master')
      and status in ('active', 'cancelled')
      and user_id is not null
  ),
  renewals as (
    select
      count(distinct s1.user_id) filter (
        where s1.created_at < now() - interval '25 days'
      )::int as eligible_m1,
      count(distinct s1.user_id) filter (
        where s1.created_at < now() - interval '25 days'
          and exists (
            select 1 from sub_payments s2
            where s2.user_id = s1.user_id
              and s2.n = 2
              and s2.created_at <= s1.created_at + interval '40 days'
          )
      )::int as renewed_m1,
      count(distinct s2.user_id) filter (
        where s2.n = 2 and s2.created_at < now() - interval '25 days'
      )::int as eligible_m2,
      count(distinct s2.user_id) filter (
        where s2.n = 2
          and s2.created_at < now() - interval '25 days'
          and exists (
            select 1 from sub_payments s3
            where s3.user_id = s2.user_id
              and s3.n = 3
              and s3.created_at <= s2.created_at + interval '40 days'
          )
      )::int as renewed_m2
    from sub_payments s1
    left join sub_payments s2 on s2.user_id = s1.user_id and s2.n = 2
    where s1.n = 1
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
      and created_at >= v_since
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
  token_days as (
    select
      case
        when v_grain = 'week' then (date_trunc('week', occurred_at at time zone 'UTC'))::date
        else (occurred_at at time zone 'UTC')::date
      end as bucket,
      coalesce(sum(
        case
          when payload ? 'total_tokens'
            and nullif(payload->>'total_tokens', '') ~ '^[0-9]+(\.[0-9]+)?$'
            then (payload->>'total_tokens')::numeric
          else 0
        end
      ), 0)::numeric as tokens
    from public.user_event_log
    where kind = 'llm_prompt_size'
      and occurred_at >= v_since
    group by 1
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
    'range_all_time', (p_days is null or p_days <= 0),
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
    'conversions', (
      select jsonb_build_object(
        'reg_total', reg_total,
        'to_navigator_pct', case when reg_total > 0 then round(100.0 * to_navigator / reg_total, 1) else null end,
        'to_trial_pct', case when reg_total > 0 then round(100.0 * to_trial / reg_total, 1) else null end,
        'to_oracle_pct', case when reg_total > 0 then round(100.0 * to_oracle / reg_total, 1) else null end,
        'to_master_pct', case when reg_total > 0 then round(100.0 * to_master / reg_total, 1) else null end,
        'renew_m1_to_m2_pct', case
          when (select eligible_m1 from renewals) > 0
            then round(100.0 * (select renewed_m1 from renewals) / (select eligible_m1 from renewals), 1)
          else null
        end,
        'renew_m2_to_m3_pct', case
          when (select eligible_m2 from renewals) > 0
            then round(100.0 * (select renewed_m2 from renewals) / (select eligible_m2 from renewals), 1)
          else null
        end,
        'renew_m1_eligible', (select eligible_m1 from renewals),
        'renew_m2_eligible', (select eligible_m2 from renewals)
      )
      from cohort_counts
    ),
    'series', jsonb_build_object(
      'registrations', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', count) order by bucket desc)
        from reg_days
      ), '[]'::jsonb),
      'active_users', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', count) order by bucket desc)
        from active_days
      ), '[]'::jsonb),
      'revenue', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bucket', bucket, 'currency', currency, 'sum', sum, 'count', count
        ) order by bucket desc)
        from lava_days
      ), '[]'::jsonb),
      'tokens', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'tokens', tokens) order by bucket desc)
        from token_days
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

revoke execute on function public.admin_dashboard_pulse(int, text) from public;
revoke execute on function public.admin_dashboard_pulse(int, text) from anon;
revoke execute on function public.admin_dashboard_pulse(int, text) from authenticated;
