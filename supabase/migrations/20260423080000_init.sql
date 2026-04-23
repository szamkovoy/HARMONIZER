-- =============================================================================
-- HARMONIZER — initial schema (0001_init)
-- =============================================================================
-- Создаёт всю доменную модель приложения:
--   • auth & profile           (users, user_settings, user_roles)
--   • каталог практик          (chakras, practices, practice_chakras)
--   • история практик          (practice_sessions, user_daily_stats)
--   • диалоги (LLM-контекст)   (conversations, messages,
--                               conversation_summaries, user_profile_memory)
--   • астрология               (astro_events_global, daily_forecasts)
--   • геомагнитка              (kp_forecast)
--   • окна возможностей        (event_reminders, push_tokens)
--   • stories                  (stories, user_story_views)
--   • баннер-объявления        (announcements, user_announcement_views)
--   • активность из Health     (health_daily)
--   • универсальный лог        (user_event_log)
--
-- Принципы:
--   • RLS включён на всех user-scoped таблицах; политики явные (select/insert/
--     update/delete отдельно).
--   • Глобальные каталоги (chakras, practices, ...) доступны публично на чтение,
--     пишет только service_role или роль 'admin' из user_roles.
--   • Расширяемость через jsonb-поля (meta, preferences, params, context).
--   • Денормализация там, где сессия должна пережить удаление каталога
--     (practice_sessions.practice_slug / practice_version).
--   • Агрегаты (user_daily_stats) пересчитываются триггером с учётом TZ юзера.
--
-- Соглашения:
--   • PK: uuid default gen_random_uuid()
--   • created_at/updated_at: timestamptz default now()
--   • updated_at обновляется триггером set_updated_at()
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Расширения
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;        -- gen_random_uuid
create extension if not exists pg_trgm;         -- полнотекст/поиск в будущем

-- -----------------------------------------------------------------------------
-- 1. Утилитарные функции
-- -----------------------------------------------------------------------------

-- Общий триггер: проставить updated_at = now()
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- is_admin() определена НИЖЕ (после создания таблицы user_roles), чтобы
-- валидатор тела функции мог сослаться на существующий объект.

-- -----------------------------------------------------------------------------
-- 2. Профиль пользователя
-- -----------------------------------------------------------------------------

create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  avatar_url      text,                           -- текущая выбранная аватарка
  avatar_variants jsonb      default '[]'::jsonb, -- { urls: [<=100 штук] }
  tz              text       default 'UTC',       -- IANA, напр. 'Europe/Moscow'
  lat             double precision,
  lon             double precision,
  location_name   text,
  locale          text       default 'ru',        -- 'ru' | 'en'
  birth_date      date,
  birth_time      time,
  birth_place     jsonb,                          -- { lat, lon, name }
  onboarded_at    timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index users_tz_idx on public.users (tz);
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create table public.user_settings (
  user_id     uuid primary key references public.users(id) on delete cascade,
  preferences jsonb       default '{}'::jsonb,
  updated_at  timestamptz default now()
);
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

create table public.user_roles (
  user_id uuid references public.users(id) on delete cascade,
  role    text not null check (role in ('admin','user')),
  primary key (user_id, role)
);

-- Проверка роли admin (SECURITY DEFINER — обходит RLS на user_roles).
-- Объявляется после user_roles, чтобы валидатор SQL-функции нашёл таблицу.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role = 'admin'
  );
$$;

-- Автосоздание public.users при регистрации в auth.users
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 3. Справочник чакр
-- -----------------------------------------------------------------------------

create table public.chakras (
  id        smallint primary key check (id between 1 and 7),
  slug      text not null unique,
  name      jsonb not null,                      -- { ru, en }
  color_hex text not null
);

-- -----------------------------------------------------------------------------
-- 4. Каталог практик
-- -----------------------------------------------------------------------------

create table public.practices (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  kind                  text not null check (kind in ('breath','meditation','yoga')),
  title                 jsonb not null,           -- { ru, en }
  description           jsonb default '{}'::jsonb,
  default_duration_sec  int,
  min_duration_sec      int,
  max_duration_sec      int,
  params                jsonb default '{}'::jsonb,
  video_provider        text  check (video_provider in ('youtube','vimeo','vk_video','rutube')),
  video_url             text,
  video_external_id     text,
  rating                numeric default 0,
  is_active             boolean default true,
  version               int default 1,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index practices_kind_active_idx on public.practices (kind, is_active);
create index practices_rating_idx on public.practices (rating desc);
create trigger practices_set_updated_at
  before update on public.practices
  for each row execute function public.set_updated_at();

create table public.practice_chakras (
  practice_id uuid references public.practices(id) on delete cascade,
  chakra_id   smallint references public.chakras(id) on delete restrict,
  is_primary  boolean default false,
  weight      numeric default 1.0 check (weight >= 0 and weight <= 1),
  primary key (practice_id, chakra_id)
);
create index practice_chakras_chakra_idx on public.practice_chakras (chakra_id);

-- -----------------------------------------------------------------------------
-- 5. История практик + дневные агрегаты
-- -----------------------------------------------------------------------------

create table public.practice_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  practice_id       uuid references public.practices(id) on delete set null,
  practice_slug     text not null,                -- денормализация
  practice_version  int  not null default 1,
  started_at        timestamptz not null,
  ended_at          timestamptz,
  duration_sec      int generated always as (
    case
      when ended_at is not null
        then greatest(0, extract(epoch from (ended_at - started_at))::int)
      else null
    end
  ) stored,
  self_rating       smallint check (self_rating in (-1, 0, 1)),
  completion_pct    numeric check (completion_pct between 0 and 100),
  metrics           jsonb default '{}'::jsonb,
  chakra_focus_ids  smallint[] default '{}',
  context           jsonb default '{}'::jsonb,
  created_at        timestamptz default now()
);
create index practice_sessions_user_started_idx
  on public.practice_sessions (user_id, started_at desc);
create index practice_sessions_user_practice_idx
  on public.practice_sessions (user_id, practice_id);

create table public.user_daily_stats (
  user_id                uuid references public.users(id) on delete cascade,
  local_date             date not null,
  total_practice_seconds int  default 0,
  practice_count         int  default 0,
  chakras_touched        smallint[] default '{}',
  updated_at             timestamptz default now(),
  primary key (user_id, local_date)
);
create index user_daily_stats_user_date_idx
  on public.user_daily_stats (user_id, local_date desc);

-- Триггер пересчёта дневной статистики: считает local_date в TZ юзера
create or replace function public.recompute_user_daily_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_started_at timestamptz;
  v_tz         text;
  v_local_date date;
begin
  if tg_op = 'DELETE' then
    v_user_id    := old.user_id;
    v_started_at := old.started_at;
  else
    v_user_id    := new.user_id;
    v_started_at := new.started_at;
  end if;

  select coalesce(tz, 'UTC') into v_tz from public.users where id = v_user_id;
  v_local_date := (v_started_at at time zone v_tz)::date;

  insert into public.user_daily_stats (
    user_id, local_date,
    total_practice_seconds, practice_count, chakras_touched, updated_at
  )
  select
    v_user_id,
    v_local_date,
    coalesce(sum(coalesce(duration_sec, 0)), 0),
    count(*),
    coalesce(
      (select array_agg(distinct c order by c)
         from (
           select unnest(chakra_focus_ids) as c
             from public.practice_sessions
            where user_id = v_user_id
              and (started_at at time zone v_tz)::date = v_local_date
         ) s
      ),
      '{}'
    ),
    now()
  from public.practice_sessions
  where user_id = v_user_id
    and (started_at at time zone v_tz)::date = v_local_date
  on conflict (user_id, local_date)
  do update set
    total_practice_seconds = excluded.total_practice_seconds,
    practice_count         = excluded.practice_count,
    chakras_touched        = excluded.chakras_touched,
    updated_at             = now();

  return null;
end;
$$;

create trigger practice_sessions_recompute_stats
  after insert or update or delete on public.practice_sessions
  for each row execute function public.recompute_user_daily_stats();

-- -----------------------------------------------------------------------------
-- 6. Диалоги / контекстное окно для LLM
-- -----------------------------------------------------------------------------

create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  started_at    timestamptz default now(),
  ended_at      timestamptz,
  title         text,
  entry_source  text check (entry_source in (
                  'home','event_reminder','practice_discuss','stories','onboarding')),
  trigger_meta  jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);
create index conversations_user_started_idx
  on public.conversations (user_id, started_at desc);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  role             text not null check (role in ('user','assistant','system')),
  content          text,
  content_type     text default 'text' check (content_type in ('text','voice')),
  audio_url        text,
  transcript       text,
  emotion_segments jsonb default '[]'::jsonb,
  meta             jsonb default '{}'::jsonb,
  created_at       timestamptz default now()
);
create index messages_conv_created_idx on public.messages (conversation_id, created_at);

create table public.conversation_summaries (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  conversation_id      uuid not null references public.conversations(id) on delete cascade,
  summary_text         text not null,
  key_topics           jsonb default '[]'::jsonb,
  chakras_mentioned    smallint[] default '{}',
  practices_mentioned  uuid[] default '{}',
  plans                jsonb default '[]'::jsonb,
  generated_at         timestamptz default now(),
  unique (conversation_id)
);
create index conversation_summaries_user_generated_idx
  on public.conversation_summaries (user_id, generated_at desc);

create table public.user_profile_memory (
  user_id                     uuid primary key references public.users(id) on delete cascade,
  key_facts                   jsonb default '{}'::jsonb,
  current_goals               jsonb default '[]'::jsonb,
  last_practice_focus_chakras smallint[] default '{}',
  recent_practices            jsonb default '[]'::jsonb,
  updated_at                  timestamptz default now()
);
create trigger user_profile_memory_set_updated_at
  before update on public.user_profile_memory
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. Астрология (глобальные данные)
-- -----------------------------------------------------------------------------

create table public.astro_events_global (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null check (event_type in (
                    'conjunction','new_moon','full_moon','first_quarter','last_quarter')),
  participants    text[] not null,                -- ['mars','jupiter'] | ['moon','sun']
  exact_time_utc  timestamptz not null,
  longitude_deg   numeric,
  significance    smallint not null default 3 check (significance between 1 and 4),
  meta            jsonb default '{}'::jsonb,
  computed_at     timestamptz default now(),
  computed_by     text,                           -- 'astronomy-engine-v2.x.x'
  unique (event_type, participants, exact_time_utc)
);
create index astro_events_time_idx on public.astro_events_global (exact_time_utc);
create index astro_events_type_time_idx on public.astro_events_global (event_type, exact_time_utc);

-- Общий (общий для всех) прогноз дня. Задел под персонализацию —
-- personalization_version; когда/если добавим user_daily_forecasts, просто
-- поднимем версию, без ломающих миграций.
create table public.daily_forecasts (
  id                      uuid primary key default gen_random_uuid(),
  forecast_date           date not null unique,   -- дата с привязкой к полудню GMT
  slogan_template         jsonb not null,         -- { ru, en }
  long_text_template      jsonb not null,         -- { ru, en }
  chakras                 jsonb default '[]'::jsonb,  -- [{ id, polarity, reason }]
  astro_summary           jsonb default '{}'::jsonb,
  personalization_version int  default 1,
  generated_at            timestamptz default now(),
  model                   text
);
create index daily_forecasts_date_idx on public.daily_forecasts (forecast_date desc);

-- -----------------------------------------------------------------------------
-- 8. Геомагнитка
-- -----------------------------------------------------------------------------

create table public.kp_forecast (
  id                 uuid primary key default gen_random_uuid(),
  published_at       timestamptz not null,
  forecast_start_utc timestamptz not null,
  forecast_end_utc   timestamptz not null,
  samples            jsonb not null,              -- [{ t_utc, kp }] шаг 3ч
  source             text not null default 'noaa_swpc',
  raw_payload        jsonb
);
create index kp_forecast_published_idx on public.kp_forecast (published_at desc);

-- -----------------------------------------------------------------------------
-- 9. Напоминания и push-токены
-- -----------------------------------------------------------------------------

create table public.event_reminders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  event_key             text not null,
  event_type            text not null check (event_type in (
                          'sunrise','sunset','moonrise','moonset',
                          'planet_rise','conjunction',
                          'new_moon','full_moon','first_quarter','last_quarter')),
  event_title           text,
  scheduled_for_utc     timestamptz not null,
  notify_before_minutes smallint not null check (notify_before_minutes in (1,5,10)),
  enabled               boolean default true,
  fired_at              timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (user_id, event_key)
);
create index event_reminders_pending_idx
  on public.event_reminders (scheduled_for_utc)
  where enabled and fired_at is null;
create trigger event_reminders_set_updated_at
  before update on public.event_reminders
  for each row execute function public.set_updated_at();

create table public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  token         text not null unique,
  platform      text not null check (platform in ('ios','android','web')),
  expo_token    boolean default true,
  is_active     boolean default true,
  created_at    timestamptz default now(),
  last_seen_at  timestamptz default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id) where is_active;

-- -----------------------------------------------------------------------------
-- 10. Stories
-- -----------------------------------------------------------------------------

create table public.stories (
  id             uuid primary key default gen_random_uuid(),
  created_by     uuid references public.users(id) on delete set null,
  publish_at     timestamptz default now(),
  expires_at     timestamptz,                      -- обычно = publish_at + 24h
  is_evergreen   boolean default false,            -- true = игнорировать expires_at
  kind           text not null check (kind in ('image','video_cover')),
  image_url      text,
  cover_url      text,
  video_provider text check (video_provider in ('youtube','vk_video','rutube','vimeo')),
  video_url      text,
  caption        jsonb default '{}'::jsonb,
  order_hint     int default 0,
  is_published   boolean default false,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index stories_published_publish_idx
  on public.stories (publish_at desc)
  where is_published;
create trigger stories_set_updated_at
  before update on public.stories
  for each row execute function public.set_updated_at();

create table public.user_story_views (
  user_id    uuid references public.users(id) on delete cascade,
  story_id   uuid references public.stories(id) on delete cascade,
  viewed_at  timestamptz default now(),
  completed boolean default false,
  primary key (user_id, story_id)
);

-- RPC для выдачи stories с логикой "свежие + фолбэк на 3 старых непросмотренных"
create or replace function public.get_user_stories(p_user_id uuid)
returns table (
  id             uuid,
  kind           text,
  image_url      text,
  cover_url      text,
  video_provider text,
  video_url      text,
  caption        jsonb,
  publish_at     timestamptz,
  expires_at     timestamptz,
  is_fresh       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now  timestamptz := now();
  v_last_publish timestamptz;
begin
  -- 1) Все "свежие" (не истёкшие) опубликованные, не просмотренные этим юзером
  return query
    select s.id, s.kind, s.image_url, s.cover_url,
           s.video_provider, s.video_url, s.caption,
           s.publish_at, s.expires_at, true as is_fresh
      from public.stories s
      left join public.user_story_views v
        on v.story_id = s.id and v.user_id = p_user_id
     where s.is_published
       and v.story_id is null
       and (s.is_evergreen or s.expires_at > v_now)
       and s.publish_at <= v_now
     order by s.order_hint asc, s.publish_at asc;

  if found then
    return;
  end if;

  -- 2) Фолбэк: если свежих нет, смотрим давность последней публикации —
  --    если новых не было уже >=3 дней, показываем до 3 самых свежих
  --    истёкших, не просмотренных юзером.
  select max(publish_at) into v_last_publish
    from public.stories
   where is_published and publish_at <= v_now;

  if v_last_publish is null or v_last_publish < v_now - interval '3 days' then
    return query
      select s.id, s.kind, s.image_url, s.cover_url,
             s.video_provider, s.video_url, s.caption,
             s.publish_at, s.expires_at, false as is_fresh
        from public.stories s
        left join public.user_story_views v
          on v.story_id = s.id and v.user_id = p_user_id
       where s.is_published
         and v.story_id is null
         and s.publish_at <= v_now
       order by s.publish_at desc
       limit 3;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Баннер-объявления (вебинары/видео/кастом)
-- -----------------------------------------------------------------------------

create table public.announcements (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('webinar','video','note','custom')),
  title             jsonb not null,               -- { ru, en }
  subtitle          jsonb default '{}'::jsonb,    -- { ru, en } напр. "21.04 · 19:00 МСК"
  starts_at         timestamptz,                  -- для вебинара: начало события
  ends_at           timestamptz,                  -- когда скрыть автоматом
  url               text,
  video_provider    text check (video_provider in ('youtube','vk_video','rutube','vimeo')),
  dismiss_on_click  boolean default false,
  priority          smallint default 100,
  is_published      boolean default false,
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index announcements_active_priority_idx
  on public.announcements (priority desc, created_at desc)
  where is_published;
create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

create table public.user_announcement_views (
  user_id         uuid references public.users(id) on delete cascade,
  announcement_id uuid references public.announcements(id) on delete cascade,
  seen_at         timestamptz,
  clicked_at      timestamptz,
  dismissed_at    timestamptz,
  primary key (user_id, announcement_id)
);

-- RPC: вернуть одно актуальное объявление для юзера (или пусто)
create or replace function public.get_user_announcement(p_user_id uuid)
returns table (
  id             uuid,
  kind           text,
  title          jsonb,
  subtitle       jsonb,
  starts_at      timestamptz,
  ends_at        timestamptz,
  url            text,
  video_provider text,
  dismiss_on_click boolean,
  priority       smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.kind, a.title, a.subtitle, a.starts_at, a.ends_at,
         a.url, a.video_provider, a.dismiss_on_click, a.priority
    from public.announcements a
    left join public.user_announcement_views v
      on v.announcement_id = a.id and v.user_id = p_user_id
   where a.is_published
     and (a.starts_at is null or a.starts_at <= now())
     and (a.ends_at   is null or a.ends_at   >  now())
     and v.dismissed_at is null
     and not (a.dismiss_on_click and v.clicked_at is not null)
   order by a.priority desc, a.created_at desc
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 12. Health (синтетический скор + сырые значения)
-- -----------------------------------------------------------------------------

create table public.health_daily (
  user_id            uuid references public.users(id) on delete cascade,
  local_date         date not null,
  steps              int,
  active_energy_kcal numeric,
  workout_minutes    int,
  activity_score     numeric,                      -- 0..100
  source             text check (source in ('apple_health','google_fit','manual')),
  raw                jsonb default '{}'::jsonb,
  updated_at         timestamptz default now(),
  primary key (user_id, local_date)
);
create index health_daily_user_date_idx
  on public.health_daily (user_id, local_date desc);
create trigger health_daily_set_updated_at
  before update on public.health_daily
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 13. Универсальный event log (append-only)
-- -----------------------------------------------------------------------------

create table public.user_event_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null,                       -- 'practice_started'|'conversation_ended'|...
  payload     jsonb default '{}'::jsonb,
  occurred_at timestamptz default now()
);
create index user_event_log_user_time_idx
  on public.user_event_log (user_id, occurred_at desc);
create index user_event_log_user_kind_time_idx
  on public.user_event_log (user_id, kind, occurred_at desc);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Включаем RLS везде
alter table public.users                    enable row level security;
alter table public.user_settings            enable row level security;
alter table public.user_roles               enable row level security;
alter table public.chakras                  enable row level security;
alter table public.practices                enable row level security;
alter table public.practice_chakras         enable row level security;
alter table public.practice_sessions        enable row level security;
alter table public.user_daily_stats         enable row level security;
alter table public.conversations            enable row level security;
alter table public.messages                 enable row level security;
alter table public.conversation_summaries   enable row level security;
alter table public.user_profile_memory      enable row level security;
alter table public.astro_events_global      enable row level security;
alter table public.daily_forecasts          enable row level security;
alter table public.kp_forecast              enable row level security;
alter table public.event_reminders          enable row level security;
alter table public.push_tokens              enable row level security;
alter table public.stories                  enable row level security;
alter table public.user_story_views         enable row level security;
alter table public.announcements            enable row level security;
alter table public.user_announcement_views  enable row level security;
alter table public.health_daily             enable row level security;
alter table public.user_event_log           enable row level security;

-- ---- Профиль ----
create policy users_self_select    on public.users for select
  using (id = auth.uid());
create policy users_self_update    on public.users for update
  using (id = auth.uid()) with check (id = auth.uid());
-- insert делается триггером on_auth_user_created (security definer), так что
-- политики на insert не нужны: обычный клиент не должен создавать профиль вручную.

create policy user_settings_self   on public.user_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_roles_self_read on public.user_roles for select
  using (user_id = auth.uid());
-- Запись ролей — только service_role (RLS его не ограничивает).

-- ---- Публичные каталоги (чтение всем, запись — только админу/service_role) ----
create policy chakras_public_read             on public.chakras          for select using (true);
create policy practices_public_read           on public.practices        for select using (true);
create policy practice_chakras_public_read    on public.practice_chakras for select using (true);

create policy practices_admin_write on public.practices
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
create policy practice_chakras_admin_write on public.practice_chakras
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---- User-scoped данные ----
create policy practice_sessions_self on public.practice_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_daily_stats_self_read on public.user_daily_stats for select
  using (user_id = auth.uid());
-- Пишет только триггер (security definer).

create policy conversations_self on public.conversations for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messages_self on public.messages for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy conversation_summaries_self_read on public.conversation_summaries for select
  using (user_id = auth.uid());
-- Пишет серверный воркер через service_role.

create policy user_profile_memory_self on public.user_profile_memory for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Астрология и Kp (глобальные, чтение всем) ----
create policy astro_events_public_read on public.astro_events_global for select using (true);
create policy daily_forecasts_public_read on public.daily_forecasts for select using (true);
create policy kp_forecast_public_read on public.kp_forecast for select using (true);
-- Пишут cron-воркеры через service_role.

-- ---- Напоминания ----
create policy event_reminders_self on public.event_reminders for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_tokens_self on public.push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Stories ----
create policy stories_public_read on public.stories for select
  using (is_published and publish_at <= now());

create policy stories_admin_write on public.stories
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy user_story_views_self on public.user_story_views for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Announcements ----
create policy announcements_public_read on public.announcements for select
  using (is_published
         and (starts_at is null or starts_at <= now())
         and (ends_at   is null or ends_at   >  now()));

create policy announcements_admin_write on public.announcements
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy user_announcement_views_self on public.user_announcement_views for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Health ----
create policy health_daily_self on public.health_daily for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Event log ----
create policy user_event_log_self on public.user_event_log for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =============================================================================
-- GRANTS для RPC-функций (чтобы клиент мог их вызвать)
-- =============================================================================
grant execute on function public.get_user_stories(uuid)       to anon, authenticated;
grant execute on function public.get_user_announcement(uuid)  to anon, authenticated;
grant execute on function public.is_admin(uuid)               to anon, authenticated;
