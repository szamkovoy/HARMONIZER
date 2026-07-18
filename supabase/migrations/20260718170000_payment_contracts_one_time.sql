-- Расширение payment_contracts под разовые покупки (вебинар, книга).
--
-- До этого таблица хранила только подписки Lava (oracle/master). Теперь кабинет
-- продаёт и разовые товары: «Разовое участие в вебинаре» (ONE_TIME). Книга пока
-- оформляется ссылкой «Подробнее» (без чекаута), но product_ref/вид оставляем
-- заделом — чтобы позже добавить прямую покупку книги без новой миграции.
--
-- Поток разовой покупки:
--   1. POST /api/account/checkout { kind:"webinar", webinarId, currency } ->
--      Lava ONE_TIME-инвойс + строка здесь (product_kind='one_time',
--      tier='webinar', product_ref=<webinar_id>, status='pending').
--   2. Вебхук payment.success для one_time НЕ меняет membership_*, а вместо
--      этого регистрирует пользователя на вебинар (webinar_registrations).
--   3. Рекуррентных списаний для one_time нет.

alter table public.payment_contracts
  add column if not exists product_kind text not null default 'subscription'
    check (product_kind in ('subscription', 'one_time'));

-- product_ref: для webinar = webinar_id (uuid как text); для подписок = null.
alter table public.payment_contracts
  add column if not exists product_ref text;

-- Расширяем допустимые значения tier: добавляем 'webinar' и 'book' (разовые).
alter table public.payment_contracts
  drop constraint if exists payment_contracts_tier_check;
alter table public.payment_contracts
  add constraint payment_contracts_tier_check
    check (tier in ('oracle', 'master', 'webinar', 'book'));

-- periodicity для разовых = ONE_TIME.
alter table public.payment_contracts
  drop constraint if exists payment_contracts_periodicity_check;
alter table public.payment_contracts
  add constraint payment_contracts_periodicity_check
    check (periodicity in ('MONTHLY', 'ONE_TIME'));

comment on column public.payment_contracts.product_kind is
  'subscription = ежемесячная подписка (oracle/master); one_time = разовая покупка (webinar/book).';
comment on column public.payment_contracts.product_ref is
  'Для one_time webinar — webinar_id (uuid как text). Для подписок — null.';

create index if not exists idx_payment_contracts_user_kind
  on public.payment_contracts(user_id, product_kind);
