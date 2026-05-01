-- PATCH 14 adapted: free tier global content without duplicating users.tier.
-- Access model:
--   premium access = membership_tier = 'premium'
--                 OR membership_tier = 'free' AND trial_expires_at > now()
--   free access    = everything else.

alter table public.users
add column if not exists membership_tier text not null default 'free'
  check (membership_tier in ('free', 'premium'));

alter table public.users
add column if not exists trial_expires_at timestamptz default (now() + interval '3 days');

comment on column public.users.membership_tier is
'Subscription membership. premium=full access; free uses trial_expires_at for 3-day full-access trial, then global free content.';

comment on column public.users.trial_expires_at is
'When a free user trial ends. Free users with trial_expires_at > now() are treated as full-access trial users.';

create index if not exists idx_users_membership_tier on public.users(membership_tier);
create index if not exists idx_users_trial_expires_at
  on public.users(trial_expires_at)
  where membership_tier = 'free';

-- No real production users yet; normalize existing rows to the new default trial model.
update public.users
set membership_tier = 'free',
    trial_expires_at = coalesce(trial_expires_at, now() + interval '3 days')
where membership_tier = 'free';

-- Ensure newly-created users receive the 3-day full-access trial.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, display_name, membership_tier, trial_expires_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email, '@', 1)),
    'free',
    now() + interval '3 days'
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create table if not exists public.global_daily_content (
  forecast_date_utc date primary key,

  planet_positions jsonb not null,
  primary_planet text not null check (
    primary_planet in ('Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn')
  ),
  primary_chakra_number int not null check (primary_chakra_number between 1 and 7),
  primary_tone text not null check (primary_tone in ('harmonic', 'dissonant', 'ambivalent_strong')),
  top_petals jsonb not null,

  slogan text not null,
  short_text text not null,
  long_explanation text not null,
  math_level jsonb not null,

  generated_at timestamptz not null default now(),
  llm_tokens_used int,
  llm_model text,
  expires_at_utc timestamptz not null
);

create index if not exists idx_global_daily_content_expires
  on public.global_daily_content(expires_at_utc);

alter table public.global_daily_content enable row level security;

drop policy if exists global_content_select_all on public.global_daily_content;
create policy global_content_select_all on public.global_daily_content
  for select using (auth.uid() is not null);

insert into public.prompts (
  prompt_key,
  prompt_type,
  use_case,
  version,
  is_active,
  template,
  variables,
  model_hint,
  temperature,
  max_output_tokens,
  response_format
) values (
  'global_morning_recommendation',
  'recommendation',
  null,
  2,
  true,
  $prompt$
ЗАДАЧА: Сгенерируй три текста — slogan, short_text (~500 знаков), long_explanation
(~1500 знаков) — для общего астропсихологического дайджеста дня. Этот текст
показывается всем пользователям бесплатного тарифа, поэтому НЕ должен
персонализироваться: только общая картина дня по положениям планет.

КАРТИНА ДНЯ (топ-3 планеты по активности):
{{top_petals_json}}

Аспекты дня (для упоминания в long_explanation):
{{aspects_json}}

ПРИНЦИПЫ:
1. Тон рекомендательный, не декларативный:
   ХОРОШО: "Сегодня естественно открывается тема..."
   ПЛОХО: "Сегодня у вас включена пятая чакра".
2. short_text — литературный микро-текст ~500 знаков:
   - вход: общее настроение дня языком состояний, без чакр;
   - разворот: внутреннее измерение темы;
   - язык состояний: 3-5 конкретных состояний главной чакры;
   - мостик: только в финале указание на чакру для практики.
3. slogan — короткая цепляющая фраза ~50 знаков.
4. long_explanation — общий астропсихологический разбор:
   - общая картина дня;
   - главная тема;
   - второй и третий лепестки;
   - 1 концептуальная опора: Лилли / Птолемей / Порфирий;
   - заключение с приглашением к практике.

ЗАПРЕЩЕНО:
- персонализация вида "у тебя сегодня";
- упоминание натальной карты пользователя;
- обращение "ты".

Используй уважительное "вы" и безличные формулировки.

ФОРМАТ ОТВЕТА: строгий JSON:
{
  "slogan": "...",
  "short_text": "...",
  "long_explanation": "..."
}
$prompt$,
  '{
    "top_petals_json": {"type": "string", "required": true},
    "aspects_json": {"type": "string", "required": true}
  }'::jsonb,
  'standard',
  0.85,
  2200,
  'json_object'
)
on conflict (prompt_key, version) do update
set is_active = excluded.is_active,
    template = excluded.template,
    variables = excluded.variables,
    model_hint = excluded.model_hint,
    temperature = excluded.temperature,
    max_output_tokens = excluded.max_output_tokens,
    response_format = excluded.response_format;
