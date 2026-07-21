-- Net settlement amounts for gateway payments (Lava now; Yandex later).
-- Gross stays on payment_contracts.amount/currency; each successful charge
-- writes a row into payment_settlements with fee + FX nets in RUB/EUR/USD.

-- ---------------------------------------------------------------------------
-- A) Mirror columns on payment_contracts (latest settlement snapshot)
-- ---------------------------------------------------------------------------
alter table public.payment_contracts
  add column if not exists fee_rate numeric(8, 6),
  add column if not exists net_amount_rub numeric(14, 2),
  add column if not exists net_amount_eur numeric(14, 2),
  add column if not exists net_amount_usd numeric(14, 2),
  add column if not exists fx_source text;

comment on column public.payment_contracts.fee_rate is
  'Acquiring fee share applied on latest settlement (e.g. 0.08 for Lava).';
comment on column public.payment_contracts.net_amount_rub is
  'Latest settlement net in RUB after fee (+ FX haircut if CBR).';
comment on column public.payment_contracts.net_amount_eur is
  'Latest settlement net in EUR after fee (+ FX haircut if CBR).';
comment on column public.payment_contracts.net_amount_usd is
  'Latest settlement net in USD after fee (+ FX haircut if CBR).';
comment on column public.payment_contracts.fx_source is
  'FX quote source for latest settlement: tbank | alfabank | cbr.';

-- ---------------------------------------------------------------------------
-- B) Per-charge settlements (first payment + renewals)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_settlements (
  id              uuid primary key default gen_random_uuid(),
  contract_id     text not null references public.payment_contracts(contract_id) on delete cascade,
  provider        text not null default 'lavatop',
  user_id         uuid references public.users(id) on delete set null,
  event_type      text not null
                  check (event_type in (
                    'payment.success',
                    'subscription.recurring.payment.success'
                  )),
  amount          numeric(14, 2) not null,
  currency        text not null check (currency in ('RUB', 'USD', 'EUR')),
  fee_rate        numeric(8, 6) not null,
  net_amount_rub  numeric(14, 2) not null,
  net_amount_eur  numeric(14, 2) not null,
  net_amount_usd  numeric(14, 2) not null,
  fx_source       text not null check (fx_source in ('tbank', 'alfabank', 'cbr')),
  paid_at         timestamptz not null,
  created_at      timestamptz not null default now()
);

comment on table public.payment_settlements is
  'One row per successful gateway charge (first payment or renewal). Nets = after acquiring fee, converted via T-Bank → Alfa → CBR.';

create index if not exists idx_payment_settlements_paid_at
  on public.payment_settlements (paid_at desc);

create index if not exists idx_payment_settlements_contract
  on public.payment_settlements (contract_id);

create index if not exists idx_payment_settlements_provider_paid
  on public.payment_settlements (provider, paid_at desc);

-- Idempotency: one first-success per contract; renewals unique by paid_at.
create unique index if not exists payment_settlements_first_success_uq
  on public.payment_settlements (contract_id)
  where event_type = 'payment.success';

create unique index if not exists payment_settlements_renewal_uq
  on public.payment_settlements (contract_id, paid_at)
  where event_type = 'subscription.recurring.payment.success';

alter table public.payment_settlements enable row level security;
-- No client policies: service role only (same pattern as payment_contracts).
