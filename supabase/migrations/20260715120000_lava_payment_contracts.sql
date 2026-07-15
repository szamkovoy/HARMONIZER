-- Платёжные контракты Lava.top: связь контрактов с пользователями,
-- статусы подписок и данные для отмены/апгрейда.
--
-- Поток:
--   1. POST /api/account/checkout создаёт контракт в Lava и строку здесь
--      (status = pending, contract_id = id инвойса Lava).
--   2. Вебхук payment.success активирует контракт (status = active),
--      обновляет users.membership_tier / membership_expires_at.
--   3. Вебхук subscription.recurring.payment.success продлевает период.
--   4. Отмена (DELETE /api/account/subscription или из ЛК Lava) ->
--      subscription.cancelled -> status = cancelled; доступ у пользователя
--      сохраняется до membership_expires_at, дальше тариф падает на free.
--
-- Клиенты к таблице не обращаются: только service role (RLS без политик).

create table if not exists public.payment_contracts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  provider           text not null default 'lavatop',
  -- ID контракта Lava: для первого платежа это id инвойса (= parentContractId
  -- последующих рекуррентных платежей).
  contract_id        text not null unique,
  tier               text not null check (tier in ('oracle', 'master')),
  currency           text not null check (currency in ('RUB', 'USD', 'EUR')),
  amount             numeric,
  periodicity        text not null default 'MONTHLY',
  -- pending: инвойс создан, оплата не подтверждена;
  -- active: оплачен, подписка живёт; cancelled: отменена (доступ до period_end);
  -- failed: первый платёж не прошёл.
  status             text not null default 'pending'
                     check (status in ('pending', 'active', 'cancelled', 'failed')),
  current_period_end timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.payment_contracts is
'Lava.top subscription contracts. Managed exclusively by the Vercel server (service role): checkout creates pending rows, webhooks activate/renew/cancel them and sync users.membership_*.';

create index if not exists idx_payment_contracts_user on public.payment_contracts(user_id);
create index if not exists idx_payment_contracts_status on public.payment_contracts(status);

alter table public.payment_contracts enable row level security;
