-- CRM import foundation (additive, safe for store production builds):
--   • nullable profile fields for legacy CRM data
--   • crm_products + legacy GetCourse group id map + user↔ product links
--   • admin access segment email_only («Только рассылки»)
--   • OTP ghost cleanup never deletes crm_imported users

-- ---------------------------------------------------------------------------
-- A) users columns
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists admin_note text,
  add column if not exists crm_imported_at timestamptz,
  add column if not exists crm_legacy_id text;

comment on column public.users.last_name is
  'Optional surname from CRM / future forms; display_name stays given name.';
comment on column public.users.phone is
  'Optional phone from CRM; not collected in app onboarding yet.';
comment on column public.users.admin_note is
  'Free-form admin comment (not CRM product tags).';
comment on column public.users.crm_imported_at is
  'Set when row originated from CRM import; with null onboarded_at+last_seen_at → email_only.';
comment on column public.users.crm_legacy_id is
  'GetCourse user id from export (dedupe / support).';

create unique index if not exists users_crm_legacy_id_uidx
  on public.users (crm_legacy_id)
  where crm_legacy_id is not null;

-- ---------------------------------------------------------------------------
-- B) product catalog + links
-- ---------------------------------------------------------------------------
create table if not exists public.crm_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_product_legacy_ids (
  legacy_group_id bigint primary key,
  product_id uuid not null references public.crm_products (id) on delete cascade
);

create table if not exists public.user_crm_products (
  user_id uuid not null references public.users (id) on delete cascade,
  product_id uuid not null references public.crm_products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists user_crm_products_product_id_idx
  on public.user_crm_products (product_id);

alter table public.crm_products enable row level security;
alter table public.crm_product_legacy_ids enable row level security;
alter table public.user_crm_products enable row level security;

-- No anon/authenticated policies — admin API uses service role.

comment on table public.crm_products is
  'Canonical CRM course/product labels for admin filter + user card chips.';
comment on table public.crm_product_legacy_ids is
  'GetCourse group id → crm_products (import-time only).';
comment on table public.user_crm_products is
  'User ↔ CRM product membership (structured; not admin_note text).';

insert into public.crm_products (slug, title, sort_order) values
  ('m1', 'М1', 10),
  ('m2', 'М2', 20),
  ('m3', 'М3', 30),
  ('m4', 'М4', 40),
  ('m5', 'М5', 50),
  ('m6', 'М6', 60),
  ('m7', 'М7', 70),
  ('month_m_zh', 'Месяц_М+Ж', 80),
  ('7uiy', '7УИЙ', 90),
  ('book_ypv', 'Книга_ЙПВ', 100),
  ('3_zhelaniya', '3_желания', 110),
  ('mk_ydp', 'МК_ЙдП', 120),
  ('mk_privychki', 'МК_Привычки', 130),
  ('muzhskaya_sila', 'Мужская_сила', 140),
  ('month_health_neck', 'Месяц_здоровья_шеи', 150),
  ('yoga_gkt', 'Йога_для_ЖКТ', 160),
  ('mk1', 'МК1', 170),
  ('mk4', 'МК4', 180),
  ('mk6', 'МК6', 190),
  ('yoga_1', 'Йога_1', 200),
  ('yoga_2', 'Йога_2', 210),
  ('yoga_3', 'Йога_3', 220),
  ('yoga_4', 'Йога_4', 230),
  ('yoga_5', 'Йога_5', 240),
  ('yoga_7', 'Йога_7', 250),
  ('yoga_36', 'Йога_36', 260),
  ('yoga_36_old', 'Йога_36_старый', 270),
  ('tantra_course', 'Тантра_курс', 280),
  ('tantra_intro', 'Тантра_введение', 290)
on conflict (slug) do update
set title = excluded.title,
    sort_order = excluded.sort_order;

insert into public.crm_product_legacy_ids (legacy_group_id, product_id)
select v.legacy_group_id, p.id
from (
  values
    (3449061::bigint, 'm1'),
    (3449062, 'm2'),
    (3449064, 'm3'),
    (3449065, 'm4'),
    (3449066, 'm5'),
    (3449068, 'm6'),
    (3449069, 'm7'),
    (3721185, 'month_m_zh'),
    (2964384, '7uiy'),
    (2581174, 'book_ypv'),
    (1925737, '3_zhelaniya'),
    (2454604, 'mk_ydp'),
    (1962386, 'mk_privychki'),
    (1697339, 'muzhskaya_sila'),
    (1779648, 'month_health_neck'),
    (1672237, 'yoga_gkt'),
    (1644159, 'mk1'),
    (1644053, 'mk4'),
    (1226656, 'mk4'),
    (1638520, 'mk6'),
    (1236370, 'mk6'),
    (256515, 'yoga_1'),
    (1610475, 'yoga_1'),
    (197906, 'yoga_2'),
    (264974, 'yoga_3'),
    (2048336, 'yoga_3'),
    (2048335, 'yoga_3'),
    (302205, 'yoga_4'),
    (1610476, 'yoga_4'),
    (436952, 'yoga_5'),
    (354302, 'yoga_7'),
    (669909, 'yoga_36'),
    (669913, 'yoga_36'),
    (669910, 'yoga_36'),
    (105092, 'yoga_36_old'),
    (92535, 'yoga_36_old'),
    (88124, 'tantra_course'),
    (138654, 'tantra_intro')
) as v(legacy_group_id, slug)
join public.crm_products p on p.slug = v.slug
on conflict (legacy_group_id) do update
set product_id = excluded.product_id;

-- ---------------------------------------------------------------------------
-- C) OTP ghost cleanup: never delete CRM-imported accounts
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_unconfirmed_auth_users(
  p_older_than interval default interval '1 hour'
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
  --   • not admin / payments / contracts
  --   • no onboarded_at / last_seen_at / crm_imported_at on public.users
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
          and (
            u.onboarded_at is not null
            or u.last_seen_at is not null
            or u.crm_imported_at is not null
          )
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

  delete from auth.users
  where id = any (v_ids)
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

comment on function public.cleanup_unconfirmed_auth_users(interval) is
  'Cron: delete never-confirmed / never-signed-in auth ghosts older than p_older_than. Skips CRM imports and anyone with last_seen/onboarded.';

-- ---------------------------------------------------------------------------
-- D) admin_search_users: email_only segment + CRM fields + product filter
-- ---------------------------------------------------------------------------
drop function if exists public.admin_search_users(
  text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz,
  int, text, int, int, text, text
);

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
  p_order text default 'desc',
  p_crm_product_slug text default null
)
returns table (
  id uuid,
  email text,
  display_name text,
  last_name text,
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
  marketing_status text,
  crm_imported_at timestamptz,
  phone text
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
      u.last_name,
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
      u.crm_imported_at,
      u.phone,
      case
        when u.crm_imported_at is not null
          and u.onboarded_at is null
          and u.last_seen_at is null
          then 'email_only'
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
        when u.crm_imported_at is not null
          and u.onboarded_at is null
          and u.last_seen_at is null
          then -1
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
        or u.last_name ilike '%' || trim(p_query) || '%'
        or u.phone ilike '%' || trim(p_query) || '%'
        or u.admin_note ilike '%' || trim(p_query) || '%'
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
      and (
        p_crm_product_slug is null or trim(p_crm_product_slug) = ''
        or exists (
          select 1
          from public.user_crm_products ucp
          join public.crm_products cp on cp.id = ucp.product_id
          where ucp.user_id = u.id
            and cp.slug = trim(p_crm_product_slug)
        )
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
    f.last_name,
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
    f.marketing_status,
    f.crm_imported_at,
    f.phone
  from filtered f
  order by
    case when coalesce(p_sort, 'created_at') = 'access'
      and lower(coalesce(p_order, 'desc')) = 'asc'
      then f.access_rank end asc nulls last,
    case when coalesce(p_sort, 'created_at') = 'access'
      and lower(coalesce(p_order, 'desc')) <> 'asc'
      then f.access_rank end desc nulls last,
    case when coalesce(p_sort, 'created_at') = 'locale'
      and lower(coalesce(p_order, 'desc')) = 'asc'
      then coalesce(f.locale, '') end asc nulls last,
    case when coalesce(p_sort, 'created_at') = 'locale'
      and lower(coalesce(p_order, 'desc')) <> 'asc'
      then coalesce(f.locale, '') end desc nulls last,
    case when coalesce(p_sort, 'created_at') not in ('access', 'locale')
      and lower(coalesce(p_order, 'desc')) = 'asc'
      then f.sort_ts end asc nulls last,
    case when coalesce(p_sort, 'created_at') not in ('access', 'locale')
      and lower(coalesce(p_order, 'desc')) <> 'asc'
      then f.sort_ts end desc nulls last,
    f.created_at desc nulls last
  limit least(coalesce(p_limit, 50), 200);
$$;

revoke all on function public.admin_search_users(
  text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz,
  int, text, int, int, text, text, text
) from public, anon, authenticated;
grant execute on function public.admin_search_users(
  text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz,
  int, text, int, int, text, text, text
) to service_role;
