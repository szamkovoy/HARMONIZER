-- Fix admin_search_users: when p_sort=access|locale, do not primary-sort by created_at.

create or replace function public.admin_search_users(
  p_query text default null,
  p_tier text default null,
  p_locale text default null,
  p_country_code text default null,
  p_city text default null,
  p_marketing_status text default null,
  p_onboarded_from timestamptz default null,
  p_onboarded_to timestamptz default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_limit int default 50,
  p_access text default null,
  p_last_seen_within_days int default null,
  p_last_seen_older_than_days int default null,
  p_sort text default 'created_at',
  p_order text default 'desc'
)
returns table (
  id uuid,
  email text,
  display_name text,
  membership_tier text,
  membership_expires_at timestamptz,
  trial_expires_at timestamptz,
  membership_started_at timestamptz,
  created_at timestamptz,
  onboarded_at timestamptz,
  last_seen_at timestamptz,
  locale text,
  country_code text,
  city text,
  marketing_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      u.id,
      au.email::text as email,
      u.display_name,
      u.membership_tier,
      u.membership_expires_at,
      u.trial_expires_at,
      u.membership_started_at,
      u.created_at,
      u.onboarded_at,
      u.last_seen_at,
      u.locale,
      u.country_code,
      u.city,
      ec.marketing_status,
      case
        when u.onboarded_at is null then 'not_in_harmonizer'
        when u.membership_tier in ('oracle', 'practitioner', 'master')
          and (u.membership_expires_at is null or u.membership_expires_at > now())
          then case
            when u.membership_tier = 'master' then 'master'
            else 'oracle'
          end
        when u.trial_expires_at is not null and u.trial_expires_at > now() then 'trial'
        else 'navigator'
      end as access_seg,
      case
        when u.membership_tier in ('oracle', 'practitioner', 'master')
          and (u.membership_expires_at is null or u.membership_expires_at > now())
          then u.membership_expires_at
        when u.trial_expires_at is not null and u.trial_expires_at > now()
          then u.trial_expires_at
        else null
      end as effective_ends_at,
      (
        select nullif(greatest(
          coalesce((
            select max(p.created_at) from public.payments p where p.user_id = u.id
          ), '-infinity'::timestamptz),
          coalesce((
            select max(s.paid_at)
            from public.payment_settlements s
            join public.payment_contracts c on c.contract_id = s.contract_id
            where c.user_id = u.id and s.refunded_at is null
          ), '-infinity'::timestamptz)
        ), '-infinity'::timestamptz)
      ) as last_payment_at,
      case
        when u.onboarded_at is null then 0
        when u.membership_tier in ('oracle', 'practitioner', 'master')
          and (u.membership_expires_at is null or u.membership_expires_at > now())
          then case when u.membership_tier = 'master' then 4 else 3 end
        when u.trial_expires_at is not null and u.trial_expires_at > now() then 1
        else 2
      end as access_rank,
      case coalesce(p_sort, 'created_at')
        when 'onboarded_at' then u.onboarded_at
        when 'tier_end' then
          case
            when u.membership_tier in ('oracle', 'practitioner', 'master')
              and (u.membership_expires_at is null or u.membership_expires_at > now())
              then u.membership_expires_at
            when u.trial_expires_at is not null and u.trial_expires_at > now()
              then u.trial_expires_at
            else null
          end
        when 'last_seen' then u.last_seen_at
        when 'last_payment' then (
          select nullif(greatest(
            coalesce((
              select max(p.created_at) from public.payments p where p.user_id = u.id
            ), '-infinity'::timestamptz),
            coalesce((
              select max(s.paid_at)
              from public.payment_settlements s
              join public.payment_contracts c on c.contract_id = s.contract_id
              where c.user_id = u.id and s.refunded_at is null
            ), '-infinity'::timestamptz)
          ), '-infinity'::timestamptz)
        )
        when 'created_at' then u.created_at
        else null
      end as sort_ts
    from public.users u
    join auth.users au on au.id = u.id
    left join public.email_contacts ec on ec.user_id = u.id
    where (
        p_query is null or trim(p_query) = ''
        or au.email ilike '%' || trim(p_query) || '%'
        or u.display_name ilike '%' || trim(p_query) || '%'
      )
      and (p_tier is null or trim(p_tier) = '' or u.membership_tier = trim(p_tier))
      and (p_locale is null or trim(p_locale) = '' or u.locale = trim(p_locale))
      and (
        p_country_code is null or trim(p_country_code) = ''
        or u.country_code = upper(trim(p_country_code))
      )
      and (
        p_city is null or trim(p_city) = ''
        or u.city ilike '%' || trim(p_city) || '%'
      )
      and (
        p_marketing_status is null or trim(p_marketing_status) = ''
        or ec.marketing_status = trim(p_marketing_status)
      )
      and (p_onboarded_from is null or u.onboarded_at >= p_onboarded_from)
      and (p_onboarded_to is null or u.onboarded_at < p_onboarded_to)
      and (p_created_from is null or u.created_at >= p_created_from)
      and (p_created_to is null or u.created_at < p_created_to)
      and (
        p_last_seen_within_days is null
        or (
          u.last_seen_at is not null
          and u.last_seen_at >= (now() - make_interval(days => p_last_seen_within_days))
        )
      )
      and (
        p_last_seen_older_than_days is null
        or u.last_seen_at is null
        or u.last_seen_at < (now() - make_interval(days => p_last_seen_older_than_days))
      )
  ),
  filtered as (
    select * from base b
    where (
      p_access is null or trim(p_access) = ''
      or b.access_seg = trim(p_access)
    )
  )
  select
    f.id,
    f.email,
    f.display_name,
    f.membership_tier,
    f.membership_expires_at,
    f.trial_expires_at,
    f.membership_started_at,
    f.created_at,
    f.onboarded_at,
    f.last_seen_at,
    f.locale,
    f.country_code,
    f.city,
    f.marketing_status
  from filtered f
  order by
    -- access: primary key is rank (0 not_in … 4 master)
    case when coalesce(p_sort, 'created_at') = 'access'
      and lower(coalesce(p_order, 'desc')) = 'asc'
      then f.access_rank end asc nulls last,
    case when coalesce(p_sort, 'created_at') = 'access'
      and lower(coalesce(p_order, 'desc')) <> 'asc'
      then f.access_rank end desc nulls last,
    -- locale
    case when coalesce(p_sort, 'created_at') = 'locale'
      and lower(coalesce(p_order, 'desc')) = 'asc'
      then coalesce(f.locale, '') end asc nulls last,
    case when coalesce(p_sort, 'created_at') = 'locale'
      and lower(coalesce(p_order, 'desc')) <> 'asc'
      then coalesce(f.locale, '') end desc nulls last,
    -- timestamp sorts (created_at / onboarded / tier_end / last_seen / last_payment)
    case when coalesce(p_sort, 'created_at') not in ('access', 'locale')
      and lower(coalesce(p_order, 'desc')) = 'asc'
      then f.sort_ts end asc nulls last,
    case when coalesce(p_sort, 'created_at') not in ('access', 'locale')
      and lower(coalesce(p_order, 'desc')) <> 'asc'
      then f.sort_ts end desc nulls last,
    f.created_at desc nulls last
  limit least(coalesce(p_limit, 50), 200);
$$;
