-- Практикум в Санкт-Петербурге: только ЮKassa, без Lava и без кабинета приложения.
-- Покупка идёт с виджета лендинга. Тариф приложения и пропуск на вебинары не выдаются.

alter table public.payment_catalog drop constraint if exists payment_catalog_tier_check;
alter table public.payment_catalog
  add constraint payment_catalog_tier_check
  check (tier in ('oracle', 'master', 'webinar', 'webinar_pack', 'book', 'spb_practicum'));

alter table public.payment_contracts drop constraint if exists payment_contracts_tier_check;
alter table public.payment_contracts
  add constraint payment_contracts_tier_check
  check (tier in ('oracle', 'master', 'webinar', 'webinar_pack', 'book', 'spb_practicum'));

insert into public.payment_catalog
  (provider, tier, currency, amount, title, description, product_kind, lava_offer_id, sort_order)
values (
  'yookassa',
  'spb_practicum',
  'RUB',
  2500,
  'Практикум в Санкт-Петербурге',
  'Разовое участие в практикуме в Санкт-Петербурге.',
  'one_time',
  null,
  60
)
on conflict (provider, tier, currency) do update
set amount = excluded.amount,
    title = excluded.title,
    description = excluded.description,
    product_kind = excluded.product_kind,
    lava_offer_id = null,
    webinar_credits = null,
    webinar_window_days = null,
    sort_order = excluded.sort_order,
    active = true,
    updated_at = now();
