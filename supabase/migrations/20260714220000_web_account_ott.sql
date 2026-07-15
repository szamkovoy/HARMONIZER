-- Личный кабинет на zamkovoi.yoga: одноразовые токены перехода (OTT)
-- + таблица app_config с kill-switch для кнопок «Личный кабинет».

-- -----------------------------------------------------------------------------
-- 1. web_ott_tokens — одноразовые токены app -> web-кабинет
-- -----------------------------------------------------------------------------
-- Создаётся сервером (_legacy_web POST /api/account/ott, service role),
-- гасится сервером (POST /api/account/session). Клиенты к таблице не
-- обращаются: RLS включён без политик.

create table if not exists public.web_ott_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token_hash  text not null unique,        -- sha256(token), сам токен нигде не хранится
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

comment on table public.web_ott_tokens is
'One-time tokens for app -> web cabinet handoff. Only the sha256 hash is stored; tokens expire in ~5 minutes and are single-use.';

create index if not exists idx_web_ott_tokens_user on public.web_ott_tokens(user_id);
create index if not exists idx_web_ott_tokens_expires on public.web_ott_tokens(expires_at);

alter table public.web_ott_tokens enable row level security;

-- -----------------------------------------------------------------------------
-- 2. app_config — серверные флаги конфигурации приложения
-- -----------------------------------------------------------------------------
-- account_links_enabled — kill-switch: при false приложение скрывает все
-- кнопки «Личный кабинет» (режим прохождения ревью Apple/Google).

create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

comment on table public.app_config is
'Runtime feature flags readable by the app. account_links_enabled=false hides all "Личный кабинет" buttons (App Review kill-switch).';

alter table public.app_config enable row level security;

drop policy if exists "app_config readable by authenticated" on public.app_config;
create policy "app_config readable by authenticated"
  on public.app_config for select
  to authenticated
  using (true);

drop policy if exists "app_config managed by admins" on public.app_config;
create policy "app_config managed by admins"
  on public.app_config for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

insert into public.app_config (key, value)
values ('account_links_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Realtime на public.users — мгновенный подхват смены тарифа в приложении
-- -----------------------------------------------------------------------------
-- Клиент подписывается на UPDATE собственной строки (RLS уже ограничивает
-- чтение своей строкой). MembershipEventsBridge показывает модалку смены уровня.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'users'
  ) then
    alter publication supabase_realtime add table public.users;
  end if;
end $$;
