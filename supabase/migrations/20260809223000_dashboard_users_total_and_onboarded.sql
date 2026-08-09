-- Dashboard KPI users: total (all rows) + onboarded (Harmonizer installed).
-- access_now stays onboarded-only.

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
      where onboarded_at is not null
    ) s
  ),
  cohort as (
    select id
    from public.users
    where created_at >= v_since
  ),
  cohort_buys as (
    select
      (select count(*) from cohort)::int as reg_total,
      (
        select count(distinct c.id)::int
        from cohort c
        join public.payment_contracts pc on pc.user_id = c.id
        where pc.product_kind = 'subscription'
          and pc.tier = 'oracle'
          and pc.status in ('active', 'cancelled')
      ) as bought_oracle,
      (
        select count(distinct c.id)::int
        from cohort c
        join public.payment_contracts pc on pc.user_id = c.id
        where pc.product_kind = 'subscription'
          and pc.tier = 'master'
          and pc.status in ('active', 'cancelled')
      ) as bought_master
  ),

  -- Subscription retention funnel: first paid gateway contract per user+tier,
  -- depth = non-refunded settlements on that contract (renewals, not re-checkouts).
  -- Month k (k>=2) only counts users whose (k-1)-th period already ended (30d * (k-1)).
  sub_journeys as (
    select
      pc.user_id,
      pc.tier,
      pc.contract_id,
      min(s.paid_at) as first_paid,
      count(*)::int as payments
    from public.payment_contracts pc
    join public.payment_settlements s on s.contract_id = pc.contract_id
    where pc.product_kind = 'subscription'
      and pc.tier in ('oracle', 'master')
      and pc.user_id is not null
      and s.refunded_at is null
    group by pc.user_id, pc.tier, pc.contract_id
  ),
  first_journey as (
    select distinct on (user_id, tier)
      user_id,
      tier,
      contract_id,
      first_paid,
      payments
    from sub_journeys
    order by user_id, tier, first_paid asc, contract_id asc
  ),
  funnel_oracle as (
    select
      coalesce(sum(case when payments >= 1 then 1 else 0 end), 0)::int as m1,
      coalesce(sum(case
        when first_paid <= now() - interval '30 days' and payments >= 2 then 1 else 0 end), 0)::int as m2,
      coalesce(sum(case
        when first_paid <= now() - interval '60 days' and payments >= 3 then 1 else 0 end), 0)::int as m3,
      coalesce(sum(case
        when first_paid <= now() - interval '90 days' and payments >= 4 then 1 else 0 end), 0)::int as m4,
      coalesce(sum(case
        when first_paid <= now() - interval '120 days' and payments >= 5 then 1 else 0 end), 0)::int as m5,
      coalesce(sum(case
        when first_paid <= now() - interval '150 days' and payments >= 6 then 1 else 0 end), 0)::int as m6,
      coalesce(sum(case
        when first_paid <= now() - interval '180 days' and payments >= 7 then 1 else 0 end), 0)::int as m7,
      coalesce(sum(case when payments >= 1 then 1 else 0 end), 0)::int as e1,
      coalesce(sum(case when first_paid <= now() - interval '30 days' then 1 else 0 end), 0)::int as e2,
      coalesce(sum(case when first_paid <= now() - interval '60 days' then 1 else 0 end), 0)::int as e3,
      coalesce(sum(case when first_paid <= now() - interval '90 days' then 1 else 0 end), 0)::int as e4,
      coalesce(sum(case when first_paid <= now() - interval '120 days' then 1 else 0 end), 0)::int as e5,
      coalesce(sum(case when first_paid <= now() - interval '150 days' then 1 else 0 end), 0)::int as e6,
      coalesce(sum(case when first_paid <= now() - interval '180 days' then 1 else 0 end), 0)::int as e7
    from first_journey
    where tier = 'oracle'
  ),
  funnel_master as (
    select
      coalesce(sum(case when payments >= 1 then 1 else 0 end), 0)::int as m1,
      coalesce(sum(case
        when first_paid <= now() - interval '30 days' and payments >= 2 then 1 else 0 end), 0)::int as m2,
      coalesce(sum(case
        when first_paid <= now() - interval '60 days' and payments >= 3 then 1 else 0 end), 0)::int as m3,
      coalesce(sum(case
        when first_paid <= now() - interval '90 days' and payments >= 4 then 1 else 0 end), 0)::int as m4,
      coalesce(sum(case
        when first_paid <= now() - interval '120 days' and payments >= 5 then 1 else 0 end), 0)::int as m5,
      coalesce(sum(case
        when first_paid <= now() - interval '150 days' and payments >= 6 then 1 else 0 end), 0)::int as m6,
      coalesce(sum(case
        when first_paid <= now() - interval '180 days' and payments >= 7 then 1 else 0 end), 0)::int as m7,
      coalesce(sum(case when payments >= 1 then 1 else 0 end), 0)::int as e1,
      coalesce(sum(case when first_paid <= now() - interval '30 days' then 1 else 0 end), 0)::int as e2,
      coalesce(sum(case when first_paid <= now() - interval '60 days' then 1 else 0 end), 0)::int as e3,
      coalesce(sum(case when first_paid <= now() - interval '90 days' then 1 else 0 end), 0)::int as e4,
      coalesce(sum(case when first_paid <= now() - interval '120 days' then 1 else 0 end), 0)::int as e5,
      coalesce(sum(case when first_paid <= now() - interval '150 days' then 1 else 0 end), 0)::int as e6,
      coalesce(sum(case when first_paid <= now() - interval '180 days' then 1 else 0 end), 0)::int as e7
    from first_journey
    where tier = 'master'
  ),
  renew_by_tier as (
    select
      tier,
      count(*) filter (where first_paid <= now() - interval '30 days')::int as eligible,
      count(*) filter (
        where first_paid <= now() - interval '30 days' and payments >= 2
      )::int as renewed
    from first_journey
    group by tier
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
  active_period as (
    select count(*)::int as n
    from public.users u
    where u.last_seen_at >= v_since
       or exists (
         select 1 from public.user_event_log e
         where e.user_id = u.id and e.occurred_at >= v_since
       )
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
      'users_onboarded', (select count(*) from public.users where onboarded_at is not null),
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
      'active_period', (select n from active_period),
      'access_now', (select jsonb_build_object(
        'navigator', navigator, 'trial', trial, 'oracle', oracle, 'master', master
      ) from access_now),
      'cohort', (select jsonb_build_object(
        'reg_total', reg_total,
        'bought_oracle', bought_oracle,
        'bought_master', bought_master
      ) from cohort_buys),
      'renew_m2', jsonb_build_object(
        'oracle_pct', (
          select case when eligible > 0 then round(100.0 * renewed / eligible, 1) else null end
          from renew_by_tier where tier = 'oracle'
        ),
        'master_pct', (
          select case when eligible > 0 then round(100.0 * renewed / eligible, 1) else null end
          from renew_by_tier where tier = 'master'
        ),
        'oracle_eligible', (select coalesce(eligible, 0) from renew_by_tier where tier = 'oracle'),
        'master_eligible', (select coalesce(eligible, 0) from renew_by_tier where tier = 'master')
      ),
      'revenue_lava', coalesce((
        select jsonb_agg(jsonb_build_object('currency', currency, 'sum', sum, 'count', count))
        from lava_period
      ), '[]'::jsonb),
      'grants_manual', (select jsonb_build_object('sum', sum, 'count', count) from grants_period)
    ),
    'funnels', jsonb_build_object(
      'oracle', (
        select jsonb_build_array(
          jsonb_build_object('reached', m1, 'eligible', e1),
          jsonb_build_object('reached', m2, 'eligible', e2),
          jsonb_build_object('reached', m3, 'eligible', e3),
          jsonb_build_object('reached', m4, 'eligible', e4),
          jsonb_build_object('reached', m5, 'eligible', e5),
          jsonb_build_object('reached', m6, 'eligible', e6),
          jsonb_build_object('reached', m7, 'eligible', e7)
        ) from funnel_oracle
      ),
      'master', (
        select jsonb_build_array(
          jsonb_build_object('reached', m1, 'eligible', e1),
          jsonb_build_object('reached', m2, 'eligible', e2),
          jsonb_build_object('reached', m3, 'eligible', e3),
          jsonb_build_object('reached', m4, 'eligible', e4),
          jsonb_build_object('reached', m5, 'eligible', e5),
          jsonb_build_object('reached', m6, 'eligible', e6),
          jsonb_build_object('reached', m7, 'eligible', e7)
        ) from funnel_master
      )
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
