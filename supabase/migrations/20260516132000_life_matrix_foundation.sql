-- =============================================================================
-- HARMONIZER v2 — life matrix foundation
-- =============================================================================
-- Adds event storage, daily matrix snapshots, structured conversation summary
-- fields, and per-day fixed target chakra for forecast synchronization.

create table if not exists public.planned_events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  conversation_id    uuid references public.conversations(id) on delete set null,
  planned_at         timestamptz not null default now(),
  planned_local_date date not null,
  expected_at        timestamptz not null,
  time_phrase_raw    text,
  time_resolution    text not null check (time_resolution in ('explicit','daypart_default','fallback_default')),
  description        text not null,
  context_snippets   jsonb not null default '[]'::jsonb,
  cells              jsonb not null default '[]'::jsonb,
  status             text not null default 'planned'
                     check (status in ('planned','summarized','expired','dismissed')),
  summarized_at      timestamptz,
  outcome_cells      jsonb,
  outcome_text       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_planned_events_user_status
  on public.planned_events (user_id, status, expected_at);

create index if not exists idx_planned_events_user_localdate
  on public.planned_events (user_id, planned_local_date);

create index if not exists idx_planned_events_due
  on public.planned_events (user_id, status, expected_at)
  where status = 'planned';

drop trigger if exists planned_events_set_updated_at on public.planned_events;
create trigger planned_events_set_updated_at
  before update on public.planned_events
  for each row execute function public.set_updated_at();

create table if not exists public.daily_matrices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  local_date   date not null,
  source       text not null check (source in ('summary','plan')),
  matrix       jsonb not null default '[]'::jsonb,
  events_count smallint not null default 0,
  range_metric real,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, local_date)
);

create index if not exists idx_daily_matrices_user_date
  on public.daily_matrices (user_id, local_date desc);

drop trigger if exists daily_matrices_set_updated_at on public.daily_matrices;
create trigger daily_matrices_set_updated_at
  before update on public.daily_matrices
  for each row execute function public.set_updated_at();

alter table public.conversation_summaries
  add column if not exists branch text
    check (branch in ('planning','summarizing','both','free','none')),
  add column if not exists phase_time text
    check (phase_time in ('morning','day','evening')),
  add column if not exists related_event_ids uuid[] default '{}',
  add column if not exists matrix_cells jsonb default '[]'::jsonb;

alter table public.user_daily_forecasts
  add column if not exists day_target_chakra smallint
    check (day_target_chakra between 1 and 7),
  add column if not exists day_target_reason text,
  add column if not exists day_target_fixed_at timestamptz;

alter table public.planned_events enable row level security;
alter table public.daily_matrices enable row level security;

drop policy if exists planned_events_self on public.planned_events;
create policy planned_events_self on public.planned_events for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists daily_matrices_self on public.daily_matrices;
create policy daily_matrices_self on public.daily_matrices for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
