-- Net FX amounts on manual grants (no acquiring fee).
alter table public.payments
  add column if not exists net_amount_rub numeric(14, 2),
  add column if not exists net_amount_eur numeric(14, 2),
  add column if not exists net_amount_usd numeric(14, 2),
  add column if not exists fx_source text;

comment on column public.payments.net_amount_rub is
  'Grant amount converted to RUB (no gateway fee; FX via T-Bank→CBR).';
comment on column public.payments.net_amount_eur is
  'Grant amount converted to EUR (no gateway fee).';
comment on column public.payments.net_amount_usd is
  'Grant amount converted to USD (no gateway fee).';
comment on column public.payments.fx_source is
  'FX quote source for grant nets: tbank | cbr.';
