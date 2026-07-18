-- Маппинг (tier, locale) -> Lava offerId для мультиязычной оплаты.
--
-- Lava не поддерживает несколько языков у одного продукта: title/description
-- продукта и name оффера автор задаёт на одном языке. Поэтому для каждого
-- языка нужен отдельный продукт Lava с локализованными офферами.
--
-- Стратегия (решение продукта 2026-07-18): один продукт на язык, fallback
-- на 'en'. Добавление языка = создание продукта в Lava + строки здесь, без
-- правки кода. tier может быть 'oracle' | 'master' | 'webinar:<id>' | 'course:<id>'
-- (задел под вебинары/курсы). Цены НЕ хранятся здесь — они тянутся из Lava
-- (GET /api/v2/products) как единственный источник правды.
--
-- Seeded-маппинг использует текущие offerId (продукт «Subscription zamkovoi»,
-- офферы Advisor/Master) как локаль 'en' — чтобы платёжный поток работал
-- сразу для тестирования. Когда автор создаст чистый английский продукт,
-- offer_id в строках обновляются (UPDATE без миграции).

create table if not exists public.payment_offers (
  id          uuid primary key default gen_random_uuid(),
  tier        text not null,
  locale      text not null check (locale in ('ru','en','de','fr','it','es','pt','nl')),
  offer_id    text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tier, locale)
);

comment on table public.payment_offers is
'Mapping (tier, locale) -> Lava offerId for localized checkout. Fallback locale = en. Prices come from Lava /api/v2/products, not stored here.';

alter table public.payment_offers enable row level security;

-- Seed: текущие офферы Advisor (oracle) и Master под локаль 'en'.
insert into public.payment_offers (tier, locale, offer_id) values
  ('oracle', 'en', '71f1b43b-051f-4b24-97ac-60b5fc8d1a11'),
  ('master', 'en', '72ef27d9-7744-427f-8b32-fe81579ba1ec')
on conflict (tier, locale) do nothing;
