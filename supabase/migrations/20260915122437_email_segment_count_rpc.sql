-- Fast email segment resolve in one Postgres round-trip.
-- Admin count was ~60s: sync_email_contacts_from_users + ~15 PostgREST pages
-- of email_contacts + ~30 user chunks. This RPC mirrors resolveEmailSegment
-- filters and returns either a count or a jsonb contact list (avoids max_rows=1000).

create or replace function public.email_segment_resolve(
  p_query jsonb,
  p_mode text default 'list'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_all_contacts boolean := coalesce((p_query->>'all_contacts')::boolean, false);
  v_all_installed boolean := coalesce((p_query->>'all_installed')::boolean, false);
  v_include_demo boolean := coalesce((p_query->>'include_demo')::boolean, false);
  v_include_new_24h boolean := coalesce((p_query->>'include_new_24h')::boolean, false);
  v_not_in_harmonizer boolean := coalesce((p_query->>'not_in_harmonizer')::boolean, false);
  v_email_only boolean := coalesce((p_query->>'email_only')::boolean, false);
  v_tiers text[] := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(coalesce(p_query->'membership_tiers', '[]'::jsonb)) as t(x)),
    '{}'::text[]
  );
  v_statuses text[] := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(coalesce(p_query->'marketing_statuses', '["active"]'::jsonb)) as t(x)),
    array['active']::text[]
  );
  v_locales text[] := coalesce(
    (select array_agg(lower(x)) from jsonb_array_elements_text(coalesce(p_query->'locales', '[]'::jsonb)) as t(x)),
    '{}'::text[]
  );
  v_countries text[] := coalesce(
    (select array_agg(upper(x)) from jsonb_array_elements_text(coalesce(p_query->'country_codes', '[]'::jsonb)) as t(x)),
    '{}'::text[]
  );
  v_email_contains text := nullif(lower(trim(coalesce(p_query->>'email_contains', ''))), '');
  v_last_seen_within int := nullif(p_query->>'last_seen_within_days', '')::int;
  v_last_seen_older int := nullif(p_query->>'last_seen_older_than_days', '')::int;
  v_acc_after date := nullif(p_query->>'account_created_on_or_after', '')::date;
  v_acc_before date := nullif(p_query->>'account_created_on_or_before', '')::date;
  v_onb_after date := nullif(p_query->>'onboarded_on_or_after', '')::date;
  v_onb_before date := nullif(p_query->>'onboarded_on_or_before', '')::date;
  v_needs_app boolean;
  v_now timestamptz := now();
  v_new24h timestamptz := now() - interval '24 hours';
  v_count int;
  v_countries_out text[];
  v_contacts jsonb;
begin
  if v_all_contacts then
    v_all_installed := false;
    v_include_demo := false;
    v_include_new_24h := false;
    v_not_in_harmonizer := false;
    v_email_only := false;
    v_tiers := '{}'::text[];
  elsif v_all_installed then
    v_include_demo := false;
    v_include_new_24h := false;
    v_not_in_harmonizer := false;
    v_email_only := false;
    v_tiers := '{}'::text[];
  end if;

  -- email_contains alone → whole base (same as normalizeEmailSegmentAudience)
  if not (
    v_all_contacts or v_all_installed or v_include_demo or v_include_new_24h
    or v_not_in_harmonizer or v_email_only or cardinality(v_tiers) > 0
  ) then
    if v_email_contains is not null then
      v_all_contacts := true;
    else
      return jsonb_build_object(
        'count', 0,
        'countries', '[]'::jsonb,
        'contacts', '[]'::jsonb,
        'no_audience', true
      );
    end if;
  end if;

  v_needs_app :=
    v_all_installed or v_include_demo or v_include_new_24h
    or v_not_in_harmonizer or v_email_only or cardinality(v_tiers) > 0;

  with base as (
    select
      c.id,
      c.email,
      c.user_id,
      c.source,
      c.marketing_status,
      c.unsubscribe_token,
      coalesce(nullif(trim(u.locale), ''), c.locale) as locale,
      coalesce(c.country_code, u.country_code) as country_code,
      u.membership_tier,
      u.last_seen_at,
      u.created_at as user_created_at,
      u.onboarded_at,
      u.trial_expires_at,
      u.crm_imported_at,
      (
        u.crm_imported_at is not null
        and u.onboarded_at is null
        and u.last_seen_at is null
      ) as is_email_only,
      (
        u.trial_expires_at is not null
        and u.trial_expires_at > v_now
      ) as on_trial
    from public.email_contacts c
    left join public.users u on u.id = c.user_id
    where c.marketing_status = any (v_statuses)
      and (not v_needs_app or c.user_id is not null)
      and (
        cardinality(v_countries) = 0
        or upper(coalesce(c.country_code, u.country_code, '')) = any (v_countries)
      )
      and (
        v_email_contains is null
        or position(v_email_contains in lower(c.email)) > 0
      )
  ),
  filtered as (
    select b.*
    from base b
    where
      case
        when b.user_id is null then
          v_all_contacts
          and v_last_seen_within is null
          and v_acc_after is null and v_acc_before is null
          and v_onb_after is null and v_onb_before is null
        when b.user_created_at is null
          and (v_acc_after is not null or v_acc_before is not null) then false
        when b.onboarded_at is null
          and (v_onb_after is not null or v_onb_before is not null) then false
        when b.membership_tier is null
             and not (v_all_contacts and not v_needs_app) then false
        else
          (
            v_all_contacts
            or v_all_installed
            or (
              (v_include_demo and b.on_trial)
              or (v_include_new_24h and b.user_created_at is not null and b.user_created_at >= v_new24h)
              or (v_not_in_harmonizer and b.onboarded_at is null and not b.is_email_only)
              or (v_email_only and b.is_email_only)
              or (
                cardinality(v_tiers) > 0
                and b.membership_tier = any (v_tiers)
                and not (b.membership_tier = 'free' and b.on_trial)
                and not b.is_email_only
              )
            )
          )
          and (
            v_last_seen_within is null
            or (
              b.last_seen_at is not null
              and (extract(epoch from (v_now - b.last_seen_at)) / 86400.0) <= v_last_seen_within
            )
          )
          and (
            v_last_seen_older is null
            or b.last_seen_at is null
            or (extract(epoch from (v_now - b.last_seen_at)) / 86400.0) >= v_last_seen_older
          )
          and (
            v_acc_after is null
            or (
              b.user_created_at is not null
              and b.user_created_at >= (v_acc_after::timestamp AT TIME ZONE 'UTC')
            )
          )
          and (
            v_acc_before is null
            or (
              b.user_created_at is not null
              and b.user_created_at
                <= ((v_acc_before::text || ' 23:59:59.999')::timestamp AT TIME ZONE 'UTC')
            )
          )
          and (
            v_onb_after is null
            or (
              b.onboarded_at is not null
              and b.onboarded_at >= (v_onb_after::timestamp AT TIME ZONE 'UTC')
            )
          )
          and (
            v_onb_before is null
            or (
              b.onboarded_at is not null
              and b.onboarded_at
                <= ((v_onb_before::text || ' 23:59:59.999')::timestamp AT TIME ZONE 'UTC')
            )
          )
      end
      and (
        cardinality(v_locales) = 0
        or lower(left(coalesce(b.locale, ''), 2)) = any (v_locales)
      )
  )
  select
    count(*)::int,
    coalesce(
      array_agg(distinct upper(f.country_code) order by upper(f.country_code))
        filter (where f.country_code is not null and length(trim(f.country_code)) = 2),
      '{}'::text[]
    ),
    case
      when p_mode = 'count' then '[]'::jsonb
      else coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', f.id,
            'email', f.email,
            'locale', f.locale,
            'country_code', f.country_code,
            'user_id', f.user_id,
            'source', f.source,
            'marketing_status', f.marketing_status,
            'unsubscribe_token', f.unsubscribe_token
          )
          order by f.id
        ),
        '[]'::jsonb
      )
    end
  into v_count, v_countries_out, v_contacts
  from filtered f;

  return jsonb_build_object(
    'count', coalesce(v_count, 0),
    'countries', to_jsonb(coalesce(v_countries_out, '{}'::text[])),
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'no_audience', false
  );
end;
$$;

revoke all on function public.email_segment_resolve(jsonb, text) from public, anon, authenticated;
grant execute on function public.email_segment_resolve(jsonb, text) to service_role;

comment on function public.email_segment_resolve(jsonb, text) is
  'Admin email segment: p_mode=count|list. Mirrors resolveEmailSegment; list returns contacts as jsonb (bypasses PostgREST max_rows).';
