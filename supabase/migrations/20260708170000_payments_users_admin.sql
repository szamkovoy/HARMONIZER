-- Этап 6 админ-панели: леджер платежей + поиск пользователей для админки.

-- 1. Леджер платежей / ручных назначений тарифа.
--    Строка = факт выдачи платного тарифа (покупка, ручное назначение, промо).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(12, 2) not null default 0,
  currency text not null default 'RUB',
  tier text not null check (tier in ('oracle', 'practitioner', 'master')),
  paid_until timestamptz,
  source text not null default 'manual' check (source in ('manual', 'store', 'promo')),
  comment text,
  created_at timestamptz not null default now()
);

create index payments_user_idx on public.payments (user_id, created_at desc);
create index payments_created_idx on public.payments (created_at desc);

alter table public.payments enable row level security;

create policy payments_admin_all on public.payments
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

comment on table public.payments is
'Леджер выдачи платных тарифов: покупки, ручные назначения из админки (source=manual), промо. Пишется сервис-ролью из /api/admin.';

-- 2. Поиск пользователей для админки: public.users не хранит email,
--    поэтому security definer с join на auth.users. Execute отозван у
--    anon/authenticated — вызывается только сервис-ролью из /api/admin.
create or replace function public.admin_search_users(
  p_query text default null,
  p_tier text default null,
  p_limit int default 50
)
returns table (
  id uuid,
  email text,
  display_name text,
  membership_tier text,
  membership_expires_at timestamptz,
  trial_expires_at timestamptz,
  created_at timestamptz
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
    u.created_at
  from public.users u
  join auth.users au on au.id = u.id
  where (
      p_query is null or trim(p_query) = ''
      or au.email ilike '%' || trim(p_query) || '%'
      or u.display_name ilike '%' || trim(p_query) || '%'
    )
    and (p_tier is null or u.membership_tier = p_tier)
  order by u.created_at desc nulls last
  limit least(coalesce(p_limit, 50), 200);
$$;

revoke execute on function public.admin_search_users(text, text, int) from public;
revoke execute on function public.admin_search_users(text, text, int) from anon;
revoke execute on function public.admin_search_users(text, text, int) from authenticated;
