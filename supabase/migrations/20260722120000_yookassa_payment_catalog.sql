-- ЮKassa (RUB): каталог цен + задел под автоплатежи (payment_method_id).
--
-- Lava.top остаётся источником цен для USD/EUR (и для RUB, пока шлюз не
-- переключён env). Для ЮKassa цены/title фиксируем у себя — не зависим от
-- Lava product feed.
--
-- Рекуррент (вариант A) пока выключен продуно (YOOKASSA_RECURRING_ENABLED);
-- колонки и таблица методов оплаты уже есть, чтобы включить без новой миграции.

-- ── Каталог SKU ─────────────────────────────────────────────────────────────
create table if not exists public.payment_catalog (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  tier         text not null
               check (tier in ('oracle', 'master', 'webinar', 'book')),
  currency     text not null
               check (currency in ('RUB', 'USD', 'EUR')),
  amount       numeric not null check (amount > 0),
  title        text not null,
  description  text,
  product_kind text not null
               check (product_kind in ('subscription', 'one_time')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (provider, tier, currency)
);

comment on table public.payment_catalog is
  'Fixed SKU prices/titles per payment provider (YooKassa RUB first). Service role only.';

create index if not exists idx_payment_catalog_provider_active
  on public.payment_catalog (provider, active)
  where active;

alter table public.payment_catalog enable row level security;

insert into public.payment_catalog
  (provider, tier, currency, amount, title, description, product_kind)
values
  (
    'yookassa', 'oracle', 'RUB', 950,
    'Тариф «Наставник»',
    'Доступ на 30 дней к уровню «Наставник» в приложении Гармонизатор.',
    'subscription'
  ),
  (
    'yookassa', 'master', 'RUB', 4950,
    'Тариф «Мастер»',
    'Доступ на 30 дней к уровню «Мастер» в приложении Гармонизатор.',
    'subscription'
  ),
  (
    'yookassa', 'webinar', 'RUB', 950,
    'Участие в вебинаре',
    'Разовая запись на ближайшую групповую консультацию (вебинар).',
    'one_time'
  ),
  (
    'yookassa', 'book', 'RUB', 1500,
    'Книга «Йога — путь волшебника»',
    'Разовая покупка электронной книги.',
    'one_time'
  )
on conflict (provider, tier, currency) do nothing;

-- ── Поля на контракте под ЮKassa / рекуррент ───────────────────────────────
alter table public.payment_contracts
  add column if not exists provider_payment_id text;

alter table public.payment_contracts
  add column if not exists payment_method_id text;

comment on column public.payment_contracts.provider_payment_id is
  'External payment id at the gateway (YooKassa payment.id). Lava uses contract_id as invoice id.';
comment on column public.payment_contracts.payment_method_id is
  'Saved YooKassa payment_method.id for future recurring charges (null until enabled).';

create unique index if not exists idx_payment_contracts_provider_payment_id
  on public.payment_contracts (provider_payment_id)
  where provider_payment_id is not null;

-- ── Saved payment methods (рекуррент, задел) ────────────────────────────────
create table if not exists public.yookassa_payment_methods (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.users(id) on delete set null,
  payment_method_id  text not null unique,
  status             text not null default 'pending'
                     check (status in ('pending', 'active', 'inactive')),
  card_last4         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.yookassa_payment_methods is
  'YooKassa saved payment methods for future autopay. Unused while YOOKASSA_RECURRING_ENABLED=false.';

create index if not exists idx_yookassa_payment_methods_user
  on public.yookassa_payment_methods (user_id);

alter table public.yookassa_payment_methods enable row level security;
