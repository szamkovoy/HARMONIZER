-- Daily FX quote cache for payment settlements.
-- One row per Moscow calendar day; shared across all Vercel instances.

create table if not exists public.fx_daily_quotes (
  quote_date       date primary key,
  source           text not null check (source in ('tbank', 'cbr')),
  pairs            jsonb not null,
  -- If true and source=cbr, T-Bank failed earlier today — do not retry until next day.
  tbank_failed     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.fx_daily_quotes is
  'One FX quote book per Moscow calendar day (T-Bank preferred, else CBR). Used by payment settlement.';

alter table public.fx_daily_quotes enable row level security;
-- Service role only (no client policies), same pattern as payment_contracts.
