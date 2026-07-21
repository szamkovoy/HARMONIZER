-- 1) Safe cleanup of never-confirmed OTP signups (ghost accounts).
-- 2) Dashboard pulse v3: cohort funnel KPIs + subscription month funnels.

-- ---------------------------------------------------------------------------
-- A) Cleanup: ONLY users who never confirmed email and never signed in.
-- Confirmed users requesting a new OTP keep email_confirmed_at → never deleted.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_unconfirmed_auth_users(
  p_older_than interval default interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_ids uuid[];
  v_deleted int := 0;
begin
  -- Strict candidate set (all must hold):
  --   • email_confirmed_at IS NULL  → never completed OTP
  --   • last_sign_in_at IS NULL     → never obtained a session
  --   • created_at older than window
  --   • not admin
  --   • no payments / payment_contracts (belt-and-suspenders)
  --   • no onboarded_at / last_seen_at on public.users
  select coalesce(array_agg(x.id), '{}'::uuid[])
  into v_ids
  from (
    select au.id
    from auth.users au
    where au.email_confirmed_at is null
      and au.last_sign_in_at is null
      and au.created_at < now() - p_older_than
      and not exists (
        select 1 from public.user_roles ur
        where ur.user_id = au.id and ur.role = 'admin'
      )
      and not exists (
        select 1 from public.payments p where p.user_id = au.id
      )
      and not exists (
        select 1 from public.payment_contracts pc where pc.user_id = au.id
      )
      and not exists (
        select 1 from public.users u
        where u.id = au.id
          and (u.onboarded_at is not null or u.last_seen_at is not null)
      )
    limit 200
  ) x;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'deleted', 0,
      'ids', '[]'::jsonb,
      'older_than', p_older_than::text,
      'ran_at', now()
    );
  end if;

  -- Cascade: public.users ON DELETE CASCADE from auth.users.
  delete from auth.users
  where id = any (v_ids)
    -- Re-check invariants at delete time (race with concurrent OTP verify).
    and email_confirmed_at is null
    and last_sign_in_at is null;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted,
    'candidate_ids', to_jsonb(v_ids),
    'older_than', p_older_than::text,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.cleanup_unconfirmed_auth_users(interval) from public;
revoke all on function public.cleanup_unconfirmed_auth_users(interval) from anon;
revoke all on function public.cleanup_unconfirmed_auth_users(interval) from authenticated;
grant execute on function public.cleanup_unconfirmed_auth_users(interval) to postgres;

-- Convenience zero-arg for cron registry.
create or replace function public.cleanup_unconfirmed_auth_users()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.cleanup_unconfirmed_auth_users(interval '24 hours');
$$;

revoke all on function public.cleanup_unconfirmed_auth_users() from public;
revoke all on function public.cleanup_unconfirmed_auth_users() from anon;
revoke all on function public.cleanup_unconfirmed_auth_users() from authenticated;
grant execute on function public.cleanup_unconfirmed_auth_users() to postgres;

-- Register hourly cleanup in self-heal cron registry.
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

-- ---------------------------------------------------------------------------
-- B) Pulse v3
-- ---------------------------------------------------------------------------
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
  -- Per-user successful subscription payment counts (lifetime), by tier.
  sub_counts as (
    select
      user_id,
      tier,
      count(*)::int as n
    from public.payment_contracts
    where product_kind = 'subscription'
      and tier in ('oracle', 'master')
      and status in ('active', 'cancelled')
      and user_id is not null
    group by user_id, tier
  ),
  funnel_oracle as (
    select
      coalesce(sum(case when n >= 1 then 1 else 0 end), 0)::int as m1,
      coalesce(sum(case when n >= 2 then 1 else 0 end), 0)::int as m2,
      coalesce(sum(case when n >= 3 then 1 else 0 end), 0)::int as m3,
      coalesce(sum(case when n >= 4 then 1 else 0 end), 0)::int as m4,
      coalesce(sum(case when n >= 5 then 1 else 0 end), 0)::int as m5,
      coalesce(sum(case when n >= 6 then 1 else 0 end), 0)::int as m6,
      coalesce(sum(case when n >= 7 then 1 else 0 end), 0)::int as m7
    from sub_counts
    where tier = 'oracle'
  ),
  funnel_master as (
    select
      coalesce(sum(case when n >= 1 then 1 else 0 end), 0)::int as m1,
      coalesce(sum(case when n >= 2 then 1 else 0 end), 0)::int as m2,
      coalesce(sum(case when n >= 3 then 1 else 0 end), 0)::int as m3,
      coalesce(sum(case when n >= 4 then 1 else 0 end), 0)::int as m4,
      coalesce(sum(case when n >= 5 then 1 else 0 end), 0)::int as m5,
      coalesce(sum(case when n >= 6 then 1 else 0 end), 0)::int as m6,
      coalesce(sum(case when n >= 7 then 1 else 0 end), 0)::int as m7
    from sub_counts
    where tier = 'master'
  ),
  -- First/second subscription payment timestamps per user+tier (for m1→m2 KPI).
  sub_ranked as (
    select
      user_id,
      tier,
      created_at,
      row_number() over (partition by user_id, tier order by created_at) as n
    from public.payment_contracts
    where product_kind = 'subscription'
      and tier in ('oracle', 'master')
      and status in ('active', 'cancelled')
      and user_id is not null
  ),
  renew_by_tier as (
    select
      s1.tier,
      count(*) filter (where s1.created_at < now() - interval '25 days')::int as eligible,
      count(*) filter (
        where s1.created_at < now() - interval '25 days'
          and exists (
            select 1 from sub_ranked s2
            where s2.user_id = s1.user_id
              and s2.tier = s1.tier
              and s2.n = 2
              and s2.created_at <= s1.created_at + interval '40 days'
          )
      )::int as renewed
    from sub_ranked s1
    where s1.n = 1
    group by s1.tier
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
      'oracle', (select jsonb_build_array(m1, m2, m3, m4, m5, m6, m7) from funnel_oracle),
      'master', (select jsonb_build_array(m1, m2, m3, m4, m5, m6, m7) from funnel_master)
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
