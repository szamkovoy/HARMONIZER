-- Журнал платёжных событий и отметка «письмо админу уже ушло».
-- Клиенты к таблицам не обращаются: только service role (RLS без политик).

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null,
  event_type text not null,
  contract_id text,
  parent_contract_id text,
  buyer_email text,
  amount numeric,
  currency text,
  status text,
  error_message text,
  raw jsonb,
  handled_result jsonb,
  http_status integer
);

comment on table public.payment_events is
  'Payment webhook, reconcile, and checkout outcomes. Written by the Vercel server (service role).';

create index payment_events_contract_id_idx on public.payment_events (contract_id, created_at desc);
create index payment_events_created_at_idx on public.payment_events (created_at desc);

alter table public.payment_events enable row level security;
revoke all on table public.payment_events from public, anon, authenticated;

-- Одно письмо админу на пару contract_id + event_type.
create table public.payment_alert_sends (
  contract_id text not null,
  event_type text not null,
  sent_at timestamptz not null default now(),
  primary key (contract_id, event_type)
);

comment on table public.payment_alert_sends is
  'Dedupes admin payment alerts: one send per contract_id and event_type.';

alter table public.payment_alert_sends enable row level security;
revoke all on table public.payment_alert_sends from public, anon, authenticated;
