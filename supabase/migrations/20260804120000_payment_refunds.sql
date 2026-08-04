-- Refunds: contract status + settlement exclusion from revenue stats.

alter table public.payment_contracts
  drop constraint if exists payment_contracts_status_check;

alter table public.payment_contracts
  add constraint payment_contracts_status_check
  check (status in ('pending', 'active', 'cancelled', 'failed', 'refunded'));

alter table public.payment_contracts
  add column if not exists refunded_at timestamptz;

alter table public.payment_settlements
  add column if not exists refunded_at timestamptz;

create index if not exists idx_payment_settlements_not_refunded
  on public.payment_settlements (paid_at)
  where refunded_at is null;
