-- Admin users list: richer filters (locale, country, city, marketing status,
-- onboarded / created date ranges). Replaces admin_search_users(text, text, int).

drop function if exists public.admin_search_users(text, text, int);

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
  p_limit int default 50
)
returns table (
  id uuid,
  email text,
  display_name text,
  membership_tier text,
  membership_expires_at timestamptz,
  trial_expires_at timestamptz,
  created_at timestamptz,
  onboarded_at timestamptz,
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
  select
    u.id,
    au.email::text,
    u.display_name,
    u.membership_tier,
    u.membership_expires_at,
    u.trial_expires_at,
    u.created_at,
    u.onboarded_at,
    u.locale,
    u.country_code,
    u.city,
    ec.marketing_status
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
  order by u.created_at desc nulls last
  limit least(coalesce(p_limit, 50), 200);
$$;

revoke execute on function public.admin_search_users(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz, int
) from public;
revoke execute on function public.admin_search_users(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz, int
) from anon;
revoke execute on function public.admin_search_users(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz, int
) from authenticated;
