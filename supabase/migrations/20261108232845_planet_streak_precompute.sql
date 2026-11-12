-- A saved day whose planet repeats the two previous calendar days is no longer
-- a finished cache. The warm job must rewrite it and the morning text before
-- the app opens, so the phone never waits on that LLM call.

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
      (
        not exists (
          select 1
          from public.user_daily_forecasts f
          where f.user_id = b.user_id
            and f.forecast_date = b.local_date
            and f.cache_valid_until > now()
        )
        or exists (
          select 1
          from public.user_daily_forecasts today
          join public.user_daily_forecasts prev1
            on prev1.user_id = today.user_id
           and prev1.forecast_date = b.local_date - 1
          join public.user_daily_forecasts prev2
            on prev2.user_id = today.user_id
           and prev2.forecast_date = b.local_date - 2
          where today.user_id = b.user_id
            and today.forecast_date = b.local_date
            and today.cache_valid_until > now()
            and today.is_alternative_choice is not true
            and today.planet_of_the_day = prev1.planet_of_the_day
            and today.planet_of_the_day = prev2.planet_of_the_day
        )
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
  'Active paid users (natal chart, seen ≤ p_active_days) whose local-date cache is incomplete, or whose saved planet of the day repeats the two previous calendar days and is not already an alternative choice. With p_claim the returned rows are leased for p_lease_minutes.';
