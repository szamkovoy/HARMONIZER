-- =============================================================================
-- HARMONIZER v2 — visible day tab foundation
-- =============================================================================
-- Makes planned events suitable for the user-facing "Day" tab and stores one
-- pending yoga practice card per user/local day.

alter table public.planned_events
  add column if not exists display_order integer,
  add column if not exists recommendation_text text,
  add column if not exists explicit_time_text text;

create index if not exists idx_planned_events_user_localdate_order
  on public.planned_events (user_id, planned_local_date, display_order nulls last, planned_at);

create table if not exists public.day_practice_offers (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  local_date         date not null,
  practice_kind      text not null check (practice_kind in ('meditation','breath','yoga')),
  practice_id        text,
  practice_slug      text not null,
  title              text not null,
  duration_sec       integer,
  launch             jsonb not null default '{}'::jsonb,
  practice_summary   jsonb not null default '{}'::jsonb,
  status             text not null default 'pending'
                     check (status in ('pending','cancelled','completed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  cancelled_at       timestamptz,
  completed_at       timestamptz
);

create unique index if not exists idx_day_practice_offers_one_pending
  on public.day_practice_offers (user_id, local_date)
  where status = 'pending';

drop trigger if exists day_practice_offers_set_updated_at on public.day_practice_offers;
create trigger day_practice_offers_set_updated_at
  before update on public.day_practice_offers
  for each row execute function public.set_updated_at();

alter table public.day_practice_offers enable row level security;

drop policy if exists day_practice_offers_self on public.day_practice_offers;
create policy day_practice_offers_self on public.day_practice_offers for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
