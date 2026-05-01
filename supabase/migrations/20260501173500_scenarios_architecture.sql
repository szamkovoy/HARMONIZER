-- PATCH 12: Scenarios Architecture.

create table if not exists public.scenarios (
  id text primary key,
  scenario_type text not null check (scenario_type in ('monologue', 'dialogue')),

  display_name jsonb not null,
  description text,

  monologue_prompt_key text,
  dialogue_use_case text,

  output_schema jsonb,
  cache_strategy text not null default 'no_cache'
    check (cache_strategy in ('per_user_per_day', 'per_user_per_calibration', 'no_cache')),

  is_active boolean not null default true,
  display_order integer default 100,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint scenarios_monologue_config check (
    scenario_type <> 'monologue'
    or (monologue_prompt_key is not null and dialogue_use_case is null)
  ),
  constraint scenarios_dialogue_config check (
    scenario_type <> 'dialogue'
    or (dialogue_use_case is not null and monologue_prompt_key is null)
  )
);

create index if not exists idx_scenarios_active
  on public.scenarios (scenario_type, display_order)
  where is_active = true;

alter table public.scenarios enable row level security;

drop policy if exists scenarios_admin_all on public.scenarios;
create policy scenarios_admin_all
  on public.scenarios for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists scenarios_authenticated_read on public.scenarios;
create policy scenarios_authenticated_read
  on public.scenarios for select
  using (auth.uid() is not null);

drop trigger if exists scenarios_set_updated_at on public.scenarios;
create trigger scenarios_set_updated_at
  before update on public.scenarios
  for each row
  execute function public.set_updated_at();

create table if not exists public.scenario_cache (
  cache_key text primary key,
  scenario_id text not null references public.scenarios(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_scenario_cache_user
  on public.scenario_cache (user_id, scenario_id);

alter table public.scenario_cache enable row level security;

drop policy if exists scenario_cache_select_own on public.scenario_cache;
create policy scenario_cache_select_own
  on public.scenario_cache for select
  using (user_id = auth.uid());

alter table public.conversations
  add column if not exists scenario_id text references public.scenarios(id);

create index if not exists idx_conversations_scenario
  on public.conversations (scenario_id);

alter table public.dialogue_phases
  drop constraint if exists dialogue_phases_use_case_check,
  add constraint dialogue_phases_use_case_check
    check (length(btrim(use_case)) > 0);

alter table public.prompts
  drop constraint if exists prompts_use_case_check,
  add constraint prompts_use_case_check
    check (use_case is null or length(btrim(use_case)) > 0);

insert into public.scenarios
  (id, scenario_type, display_name, description, monologue_prompt_key, dialogue_use_case, output_schema, cache_strategy, display_order)
values
  (
    'psychological_portrait',
    'monologue',
    '{"ru": "Психологический портрет", "en": "Psychological portrait"}'::jsonb,
    'Генерируется один раз после ввода натальной карты. Используется только для калибровки.',
    'monologue_psychological_portrait',
    null,
    '{"type": "object", "properties": {"portrait": {"type": "string"}, "portrait_chunks": {"type": "object"}}, "required": ["portrait"]}'::jsonb,
    'no_cache',
    10
  ),
  (
    'morning_recommendation',
    'monologue',
    '{"ru": "Утренняя рекомендация", "en": "Morning recommendation"}'::jsonb,
    'Генерируется одним запросом: слоган + короткий текст + развёрнутое объяснение.',
    'monologue_morning_recommendation',
    null,
    '{"type": "object", "properties": {"slogan": {"type": "string", "maxLength": 80}, "short_text": {"type": "string"}, "long_explanation": {"type": "string"}}, "required": ["slogan", "short_text", "long_explanation"]}'::jsonb,
    'per_user_per_day',
    20
  ),
  (
    'deep_explanation',
    'monologue',
    '{"ru": "Развёрнутое объяснение дня", "en": "Deep day explanation"}'::jsonb,
    'Объясняет астрологическую механику дня для интересующихся пользователей.',
    'monologue_deep_explanation',
    null,
    '{"type": "object", "properties": {"explanation": {"type": "string"}}, "required": ["explanation"]}'::jsonb,
    'per_user_per_day',
    30
  ),
  (
    'calibration',
    'dialogue',
    '{"ru": "Калибровка профиля", "en": "Profile calibration"}'::jsonb,
    'Голосовой диалог калибровки силы и гармоничности планет на основе натальной карты.',
    null,
    'calibration',
    null,
    'no_cache',
    100
  ),
  (
    'daily_dialog',
    'dialogue',
    '{"ru": "Обсуждение дня", "en": "Day discussion"}'::jsonb,
    'Голосовой диалог обсуждения рекомендации дня и подбора практики.',
    null,
    'daily_dialog',
    null,
    'no_cache',
    110
  )
on conflict (id) do update set
  scenario_type = excluded.scenario_type,
  display_name = excluded.display_name,
  description = excluded.description,
  monologue_prompt_key = excluded.monologue_prompt_key,
  dialogue_use_case = excluded.dialogue_use_case,
  output_schema = excluded.output_schema,
  cache_strategy = excluded.cache_strategy,
  display_order = excluded.display_order,
  is_active = true;
