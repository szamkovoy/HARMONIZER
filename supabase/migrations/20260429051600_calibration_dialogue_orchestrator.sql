-- =============================================================================
-- HARMONIZER — calibration + dialogue orchestrator architecture
-- =============================================================================
-- Фаза 1 из MIGRATION_PLAN:
--   • M1 natal profile cache
--   • M2 daily forecast cache
--   • M3 calibration versions
--   • M4 prompt/phase registry and state proposals
--   • user practice preferences derived from completed sessions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. user_natal_charts — натальный профиль M1
-- -----------------------------------------------------------------------------
create table public.user_natal_charts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  version integer not null,
  is_active boolean not null default true,

  precision_mode text not null check (precision_mode in ('precise', 'approximate', 'unknown')),
  is_day_chart boolean not null,
  ascendant_longitude real,
  house_system text not null check (house_system in ('whole_sign_asc', 'whole_sign_sun')),

  planets jsonb not null,
  ephemeris_lib_version text,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (user_id, version)
);

create index idx_user_natal_charts_active
  on public.user_natal_charts (user_id)
  where is_active = true;
create unique index idx_user_natal_charts_one_active
  on public.user_natal_charts (user_id)
  where is_active = true;

-- -----------------------------------------------------------------------------
-- 2. user_calibrations — калибровки пользователя M3
-- -----------------------------------------------------------------------------
create table public.user_calibrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  version integer not null,
  source text not null check (source in ('initial', 'manual_resync', 'auto_aggregated')),
  based_on_version integer,
  is_active boolean not null default true,

  s_calibrated jsonb not null,
  h_calibrated jsonb not null,
  delta_from_initial jsonb not null,

  states_map jsonb not null,
  user_lexicon jsonb not null,

  raw_feedback jsonb not null,
  portrait text,
  portrait_chunks jsonb,

  last_calibration_date timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (user_id, version)
);

create index idx_user_calibrations_active
  on public.user_calibrations (user_id)
  where is_active = true;
create index idx_user_calibrations_history
  on public.user_calibrations (user_id, version desc);
create unique index idx_user_calibrations_one_active
  on public.user_calibrations (user_id)
  where is_active = true;

-- -----------------------------------------------------------------------------
-- 3. user_daily_forecasts — кэш дневных прогнозов M2
-- -----------------------------------------------------------------------------
create table public.user_daily_forecasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  forecast_date date not null,
  user_timezone text not null,

  importance jsonb not null,
  activation jsonb not null,
  ranked_planets jsonb not null,

  planet_of_the_day text not null check (
    planet_of_the_day in ('Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn')
  ),
  is_alternative_choice boolean not null default false,
  alternative_reason_text text,

  today_planet_state jsonb not null,
  windows_of_opportunity jsonb not null,
  transit_chart jsonb not null,

  recommendation_short_text text,
  recommendation_long_text text,
  is_corrected_via_dialog boolean not null default false,
  corrected_at timestamptz,

  computed_at timestamptz not null default now(),
  cache_valid_until timestamptz not null,

  unique (user_id, forecast_date)
);

create index idx_user_daily_forecasts_date
  on public.user_daily_forecasts (user_id, forecast_date desc);

-- -----------------------------------------------------------------------------
-- 4. prompts — управляемые промпты Gemini
-- -----------------------------------------------------------------------------
create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  prompt_type text not null check (
    prompt_type in ('system', 'phase', 'orchestrator', 'extraction', 'summary', 'recommendation', 'portrait')
  ),
  use_case text check (use_case in ('calibration', 'daily_dialog', 'portrait') or use_case is null),

  version integer not null,
  is_active boolean not null default false,

  template text not null,
  variables jsonb not null default '{}'::jsonb,

  model_hint text,
  max_output_tokens integer default 1024,
  temperature real default 0.7,
  response_format text default 'text' check (response_format in ('text', 'json_object')),

  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),

  unique (prompt_key, version)
);

create unique index idx_prompts_one_active
  on public.prompts (prompt_key)
  where is_active = true;
create index idx_prompts_use_case
  on public.prompts (use_case, prompt_type);

-- -----------------------------------------------------------------------------
-- 5. dialogue_phases — реестр фаз для каждого use case
-- -----------------------------------------------------------------------------
create table public.dialogue_phases (
  id uuid primary key default gen_random_uuid(),
  use_case text not null check (use_case in ('calibration', 'daily_dialog')),
  phase_id text not null,

  prompt_key text not null,
  is_terminal boolean not null default false,
  is_silent boolean not null default false,

  description text,
  display_order integer,

  is_active boolean not null default true,

  unique (use_case, phase_id)
);

create index idx_dialogue_phases_use_case
  on public.dialogue_phases (use_case)
  where is_active = true;

-- -----------------------------------------------------------------------------
-- 6. ai_state_proposals — предложения ИИ для states_map
-- -----------------------------------------------------------------------------
create table public.ai_state_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,

  proposed_planet text not null check (
    proposed_planet in ('Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn')
  ),
  proposed_label text not null,
  proposed_polarity text not null check (proposed_polarity in ('positive', 'negative')),
  trigger_phrase text,

  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  responded_at timestamptz,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index idx_ai_state_proposals_pending
  on public.ai_state_proposals (user_id)
  where status = 'pending';

-- -----------------------------------------------------------------------------
-- 7. user_practice_preferences — персональные предпочтения по практикам
-- -----------------------------------------------------------------------------
create table public.user_practice_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_rating real,
  is_favorite boolean not null default false,
  is_skipped boolean not null default false,
  last_completed_at timestamptz,
  completion_count integer not null default 0,
  primary key (user_id, practice_id)
);

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------
alter table public.user_natal_charts enable row level security;
alter table public.user_calibrations enable row level security;
alter table public.user_daily_forecasts enable row level security;
alter table public.prompts enable row level security;
alter table public.dialogue_phases enable row level security;
alter table public.ai_state_proposals enable row level security;
alter table public.user_practice_preferences enable row level security;

create policy user_natal_charts_self
  on public.user_natal_charts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_calibrations_select_own
  on public.user_calibrations for select
  using (user_id = auth.uid());
-- Запись калибровок выполняет backend/service_role, чтобы не обходить защиту от дрейфа.

create policy user_daily_forecasts_self
  on public.user_daily_forecasts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy prompts_admin_all
  on public.prompts for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy dialogue_phases_admin_all
  on public.dialogue_phases for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy ai_state_proposals_select_own
  on public.ai_state_proposals for select
  using (user_id = auth.uid());

create policy ai_state_proposals_update_own
  on public.ai_state_proposals for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_practice_preferences_self
  on public.user_practice_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Practice preferences trigger
-- -----------------------------------------------------------------------------
create or replace function public.update_practice_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.practice_id is null or new.ended_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.ended_at is not null then
    return new;
  end if;

  insert into public.user_practice_preferences (
    user_id,
    practice_id,
    last_completed_at,
    completion_count
  )
  values (
    new.user_id,
    new.practice_id,
    new.ended_at,
    1
  )
  on conflict (user_id, practice_id)
  do update set
    last_completed_at = greatest(
      public.user_practice_preferences.last_completed_at,
      excluded.last_completed_at
    ),
    completion_count = public.user_practice_preferences.completion_count + 1;

  return new;
end;
$$;

create trigger practice_sessions_update_prefs
  after insert or update on public.practice_sessions
  for each row
  when (new.ended_at is not null)
  execute function public.update_practice_preferences();
