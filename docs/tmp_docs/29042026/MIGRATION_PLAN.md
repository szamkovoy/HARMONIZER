# MIGRATION PLAN — Пошаговый план изменений (с Orchestrator architecture)

Этот документ — практическое руководство для Cursor: что именно нужно изменить в существующем коде и БД для перехода с текущей реализации на новую архитектуру с Orchestrator-Driven Dialogue.

---

## Обзор изменений

| Категория | Изменений |
|---|---|
| Новые таблицы БД | 6 |
| Изменённые таблицы БД | 0 (используем существующие jsonb-поля) |
| Удалённые таблицы | 0 |
| Новые backend endpoints | 8 |
| Удалённые backend endpoints | 1 (старый /api/communicator) |
| Новые frontend модули | M1 (astro-core), M2 (daily-engine), новый Communicator с фазами |
| Переписанные frontend модули | services/communicator-client.ts |
| Удалённые frontend файлы | modules/communicator/core/transcript-parser.ts |
| Новые JSON-файлы | 5 |
| Seed-данные | ~15 базовых промптов |

---

## Фаза 1: Миграции БД (Supabase)

Создать `supabase/migrations/<timestamp>_calibration_dialogue_orchestrator.sql`:

```sql
-- =============================================
-- 1. user_natal_charts — натальный профиль
-- =============================================
CREATE TABLE public.user_natal_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  
  precision_mode text NOT NULL CHECK (precision_mode IN ('precise', 'approximate', 'unknown')),
  is_day_chart boolean NOT NULL,
  ascendant_longitude real,
  house_system text NOT NULL CHECK (house_system IN ('whole_sign_asc', 'whole_sign_sun')),
  
  planets jsonb NOT NULL,                    -- 7 планет с E, Ac, S_initial, H_initial
  ephemeris_lib_version text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (user_id, version)
);

CREATE INDEX idx_user_natal_charts_active ON public.user_natal_charts(user_id) WHERE is_active = true;

ALTER TABLE public.user_natal_charts ENABLE ROW LEVEL SECURITY;
CREATE POLICY natal_charts_select_own ON public.user_natal_charts FOR SELECT USING (user_id = auth.uid());

-- =============================================
-- 2. user_calibrations — калибровки пользователя
-- =============================================
CREATE TABLE public.user_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  source text NOT NULL CHECK (source IN ('initial', 'manual_resync', 'auto_aggregated')),
  based_on_version integer,
  is_active boolean NOT NULL DEFAULT true,
  
  s_calibrated jsonb NOT NULL,
  h_calibrated jsonb NOT NULL,
  delta_from_initial jsonb NOT NULL,
  
  states_map jsonb NOT NULL,                 -- семантическая карта по 7 чакрам
  user_lexicon jsonb NOT NULL,               -- лингвистический словарь
  
  raw_feedback jsonb NOT NULL,
  portrait text,
  portrait_chunks jsonb,
  
  last_calibration_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (user_id, version)
);

CREATE INDEX idx_user_calibrations_active ON public.user_calibrations(user_id) WHERE is_active = true;
CREATE INDEX idx_user_calibrations_history ON public.user_calibrations(user_id, version DESC);

ALTER TABLE public.user_calibrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY calibrations_select_own ON public.user_calibrations FOR SELECT USING (user_id = auth.uid());

-- =============================================
-- 3. user_daily_forecasts — кэш дневных прогнозов M2
-- =============================================
CREATE TABLE public.user_daily_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  forecast_date date NOT NULL,
  user_timezone text NOT NULL,
  
  importance jsonb NOT NULL,
  activation jsonb NOT NULL,
  ranked_planets jsonb NOT NULL,
  
  planet_of_the_day text NOT NULL,
  is_alternative_choice boolean NOT NULL DEFAULT false,
  alternative_reason_text text,
  
  today_planet_state jsonb NOT NULL,
  windows_of_opportunity jsonb NOT NULL,
  transit_chart jsonb NOT NULL,
  
  recommendation_short_text text,
  recommendation_long_text text,
  is_corrected_via_dialog boolean NOT NULL DEFAULT false,
  corrected_at timestamptz,
  
  computed_at timestamptz NOT NULL DEFAULT now(),
  cache_valid_until timestamptz NOT NULL,
  
  UNIQUE (user_id, forecast_date)
);

CREATE INDEX idx_user_daily_forecasts_date ON public.user_daily_forecasts(user_id, forecast_date DESC);

ALTER TABLE public.user_daily_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_forecasts_select_own ON public.user_daily_forecasts FOR SELECT USING (user_id = auth.uid());

-- =============================================
-- 4. prompts — управляемые промпты Gemini (с поддержкой Orchestrator)
-- =============================================
CREATE TABLE public.prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key text NOT NULL,
  prompt_type text NOT NULL CHECK (prompt_type IN (
    'system',           -- глобальная системная роль (responder)
    'phase',            -- инструкция конкретной фазы диалога
    'orchestrator',     -- промпт для оркестратора
    'extraction',       -- извлечение дельт калибровки
    'summary',          -- суммаризация истории
    'recommendation',   -- генерация дневной рекомендации
    'portrait'          -- генерация портрета
  )),
  
  -- Use case к которому применим этот промпт. NULL = универсальный.
  use_case text CHECK (use_case IN ('calibration', 'daily_dialog', 'portrait', NULL)),
  
  version integer NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  
  template text NOT NULL,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Параметры LLM-вызова
  model_hint text,                           -- "gemini-2.5-flash" / "gemini-2.5-flash-8b" / "gemini-2.5-pro"
  max_output_tokens integer DEFAULT 1024,
  temperature real DEFAULT 0.7,
  response_format text DEFAULT 'text' CHECK (response_format IN ('text', 'json_object')),
  
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (prompt_key, version)
);

CREATE INDEX idx_prompts_active ON public.prompts(prompt_key) WHERE is_active = true;
CREATE INDEX idx_prompts_use_case ON public.prompts(use_case, prompt_type);

ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY prompts_admin_all ON public.prompts FOR ALL USING (is_admin(auth.uid()));
-- Service role обходит RLS, поэтому бэкенд читает prompts свободно

-- =============================================
-- 5. dialogue_phases — реестр фаз для каждого use case
-- =============================================
-- Это таблица ССЫЛОК на промпты, описывающая граф фаз. Оркестратор использует её,
-- чтобы знать, какие фазы доступны для текущего use case.
CREATE TABLE public.dialogue_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  use_case text NOT NULL CHECK (use_case IN ('calibration', 'daily_dialog')),
  phase_id text NOT NULL,                    -- "welcome_and_hint", "collect_state", etc.
  
  prompt_key text NOT NULL,                  -- ссылка на запись в prompts
  is_terminal boolean NOT NULL DEFAULT false, -- если true — после этой фазы диалог закрывается
  is_silent boolean NOT NULL DEFAULT false,   -- listen_user — служебная, без ответа ассистента
  
  description text,                          -- человекочитаемое описание для админа
  display_order integer,
  
  is_active boolean NOT NULL DEFAULT true,
  
  UNIQUE (use_case, phase_id)
);

CREATE INDEX idx_dialogue_phases_use_case ON public.dialogue_phases(use_case) WHERE is_active = true;

ALTER TABLE public.dialogue_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY phases_admin_all ON public.dialogue_phases FOR ALL USING (is_admin(auth.uid()));

-- =============================================
-- 6. ai_state_proposals — предложения ИИ для states_map
-- =============================================
CREATE TABLE public.ai_state_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  
  proposed_planet text NOT NULL,
  proposed_label text NOT NULL,
  proposed_polarity text NOT NULL CHECK (proposed_polarity IN ('positive', 'negative')),
  trigger_phrase text,
  
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  responded_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX idx_ai_state_proposals_pending ON public.ai_state_proposals(user_id) WHERE status = 'pending';

ALTER TABLE public.ai_state_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposals_select_own ON public.ai_state_proposals FOR SELECT USING (user_id = auth.uid());
CREATE POLICY proposals_update_own ON public.ai_state_proposals FOR UPDATE USING (user_id = auth.uid());

-- =============================================
-- 7. user_practice_preferences — персональные предпочтения по практикам
-- =============================================
CREATE TABLE public.user_practice_preferences (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  user_rating real,
  is_favorite boolean NOT NULL DEFAULT false,
  is_skipped boolean NOT NULL DEFAULT false,
  last_completed_at timestamptz,
  completion_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, practice_id)
);

ALTER TABLE public.user_practice_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_prefs_select_own ON public.user_practice_preferences FOR SELECT USING (user_id = auth.uid());
CREATE POLICY practice_prefs_update_own ON public.user_practice_preferences FOR ALL USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION update_practice_preferences()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.practice_id IS NOT NULL THEN
    INSERT INTO public.user_practice_preferences (user_id, practice_id, last_completed_at, completion_count)
    VALUES (NEW.user_id, NEW.practice_id, NEW.ended_at, 1)
    ON CONFLICT (user_id, practice_id)
    DO UPDATE SET 
      last_completed_at = EXCLUDED.last_completed_at,
      completion_count = public.user_practice_preferences.completion_count + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER practice_sessions_update_prefs
  AFTER INSERT OR UPDATE ON public.practice_sessions
  FOR EACH ROW
  WHEN (NEW.ended_at IS NOT NULL)
  EXECUTE FUNCTION update_practice_preferences();
```

После выполнения: `npx supabase gen types typescript --local > services/supabase-types.ts`

---

## Фаза 2: Базовые seed-данные (промпты и фазы)

Создать `supabase/seeds/01_default_prompts_and_phases.sql`:

### 2.1. Промпт оркестратора

```sql
INSERT INTO public.prompts 
  (prompt_key, prompt_type, use_case, version, is_active, template, variables, model_hint, temperature, max_output_tokens, response_format, notes)
VALUES (
  'orchestrator_decision', 'orchestrator', NULL, 1, true,
  'Ты — оркестратор диалога в приложении психологической гармонизации. Ты не общаешься с пользователем напрямую. Твоя задача — после каждого сообщения пользователя решить, КАКАЯ ФАЗА должна быть следующей в диалоге.

ТЕКУЩИЙ USE CASE: {{use_case}}
ДОСТУПНЫЕ ФАЗЫ для этого use case:
{{available_phases}}

ОСИ ИНФОРМАЦИИ для этого use case:
{{information_axes}}

ВРЕМЯ СУТОК пользователя: {{time_of_day}} ({{local_hour}}:00 локально)
ПОДСКАЗКА ПО ВРЕМЕНИ: {{time_of_day_hint}}

НОМЕР ИТЕРАЦИИ: {{iteration_number}} (soft cap: {{soft_cap}})

ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ (краткая сводка):
{{user_profile_summary}}

ИСТОРИЯ ДИАЛОГА:
{{conversation_history}}

ПОСЛЕДНЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:
{{user_message}}

—

ЗАДАЧА:

1. Оцени, насколько каждая ось информации заполнена (0..1) на основе всего диалога.

2. Оцени information_density последнего сообщения (0..1):
   - 0.0–0.3 — короткое, неинформативное
   - 0.3–0.6 — обычное
   - 0.6–1.0 — плотное, развёрнутое, с конкретикой

3. Определи user_signals из списка: open, closed, self_reflective, deflecting, ready_for_action, needs_processing, disengaged, confused, verbose, terse.

4. Реши, нужно ли закрывать диалог (should_close = true), если:
   - Все оси превысили threshold
   - Soft cap исчерпан и пользователь не углубляется
   - Пользователь disengaged или несколько раз "не знаю"
   - Цель достигнута

5. Выбери next_phase из ДОСТУПНЫХ. Если should_close — закрывающую фазу.

6. Дай responder_hints: tone (warm/neutral/energising/calming), какие фразы пользователя стоит ре-юзнуть, какие темы избегать.

ПРАВИЛА:
- Если пользователь сразу дал плотный ответ (density > 0.7) — НЕ задавай уточняющих вопросов. Переходи к insight или practice.
- Если пользователь terse 2 раза подряд — переходи к offer_insight или ask_practice_intent. Не дави.
- Циклы deepen_inquiry → collect_state допустимы максимум 2 раза.

ФОРМАТ ОТВЕТА: строгий JSON, без markdown:
{
  "next_phase": "...",
  "reasoning": "1-2 предложения почему эта фаза",
  "information_completeness": { "axis_name": 0.0..1.0 },
  "information_density": 0.0..1.0,
  "user_signals": [...],
  "should_close": true|false,
  "close_reason": "goal_reached|soft_cap_hit|user_disengaged|null",
  "responder_hints": {
    "tone": "warm|neutral|energising|calming",
    "use_user_phrases": [],
    "avoid_topics": []
  }
}',
  '{"use_case":{"type":"string","required":true},"available_phases":{"type":"string","required":true},"information_axes":{"type":"string","required":true},"time_of_day":{"type":"string","required":true},"local_hour":{"type":"number","required":true},"time_of_day_hint":{"type":"string","required":true},"iteration_number":{"type":"number","required":true},"soft_cap":{"type":"number","required":true},"user_profile_summary":{"type":"string","required":true},"conversation_history":{"type":"string","required":true},"user_message":{"type":"string","required":true}}'::jsonb,
  'gemini-2.5-flash', 0.3, 512, 'json_object',
  'Главный оркестратор. Решает, какую фазу диалога вызывать дальше.'
);
```

### 2.2. Промпт responder

```sql
INSERT INTO public.prompts (prompt_key, prompt_type, use_case, version, is_active, template, variables, model_hint, temperature, max_output_tokens) VALUES (
  'responder_main', 'system', NULL, 1, true,
  '<Полный текст из MODULE_4 раздел "Промпт responder (базовый)">',
  '{"current_phase":{"type":"string","required":true},"phase_instruction":{"type":"string","required":true},"tone":{"type":"string","required":false},"style_markers":{"type":"object","required":false},"user_phrases":{"type":"string","required":false},"use_user_phrases":{"type":"array","required":false},"avoid_topics":{"type":"array","required":false},"user_profile_summary":{"type":"string","required":true},"daily_context":{"type":"string","required":false}}'::jsonb,
  'gemini-2.5-flash', 0.7, 400
);
```

### 2.3. Промпты фаз для калибровки

```sql
INSERT INTO public.prompts (prompt_key, prompt_type, use_case, version, is_active, template, variables, model_hint, temperature, max_output_tokens) VALUES
  ('phase_welcome_and_hint', 'phase', 'calibration', 1, true, '<текст из MODULE_4>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 250),
  ('phase_listen_user', 'phase', 'calibration', 1, true, '[silent phase, нет ответа]', '{}'::jsonb, NULL, 0, 0),
  ('phase_deepen_specific_chakra', 'phase', 'calibration', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 200),
  ('phase_acknowledge_and_close', 'phase', 'calibration', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.6, 250);
```

### 2.4. Промпты фаз для daily_dialog

```sql
INSERT INTO public.prompts (prompt_key, prompt_type, use_case, version, is_active, template, variables, model_hint, temperature, max_output_tokens) VALUES
  ('phase_contextual_greeting', 'phase', 'daily_dialog', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash-8b', 0.8, 200),
  ('phase_collect_state', 'phase', 'daily_dialog', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 250),
  ('phase_deepen_inquiry', 'phase', 'daily_dialog', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 200),
  ('phase_offer_insight', 'phase', 'daily_dialog', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 350),
  ('phase_ask_practice_intent', 'phase', 'daily_dialog', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 200),
  ('phase_suggest_practice', 'phase', 'daily_dialog', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 300),
  ('phase_confirm_and_close', 'phase', 'daily_dialog', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.6, 250);
```

### 2.5. Регистрация фаз в dialogue_phases

```sql
INSERT INTO public.dialogue_phases (use_case, phase_id, prompt_key, is_terminal, is_silent, description, display_order) VALUES
  -- Calibration
  ('calibration', 'welcome_and_hint',         'phase_welcome_and_hint',         false, false, 'Приветствие и инструкция',                  1),
  ('calibration', 'listen_user',              'phase_listen_user',              false, true,  'Служебная фаза — пользователь говорит',     2),
  ('calibration', 'deepen_specific_chakra',   'phase_deepen_specific_chakra',   false, false, 'Уточнение по конкретной чакре',             3),
  ('calibration', 'acknowledge_and_close',    'phase_acknowledge_and_close',    true,  false, 'Благодарность и закрытие',                  4),
  
  -- Daily dialog
  ('daily_dialog', 'contextual_greeting',     'phase_contextual_greeting',      false, false, 'Контекстное приветствие',                   1),
  ('daily_dialog', 'collect_state',           'phase_collect_state',            false, false, 'Сбор информации о состоянии',               2),
  ('daily_dialog', 'deepen_inquiry',          'phase_deepen_inquiry',           false, false, 'Углубление вопроса',                        3),
  ('daily_dialog', 'offer_insight',           'phase_offer_insight',            false, false, 'Один инсайт',                               4),
  ('daily_dialog', 'ask_practice_intent',     'phase_ask_practice_intent',      false, false, 'Уточнение длительности и типа',             5),
  ('daily_dialog', 'suggest_practice',        'phase_suggest_practice',         false, false, 'Предложение конкретной практики',           6),
  ('daily_dialog', 'confirm_and_close',       'phase_confirm_and_close',        true,  false, 'Подтверждение и завершение',                7);
```

### 2.6. Промпты вспомогательные

```sql
INSERT INTO public.prompts (prompt_key, prompt_type, use_case, version, is_active, template, variables, model_hint, temperature, max_output_tokens, response_format) VALUES
  ('calibration_extraction', 'extraction', 'calibration', 1, true, '<полный из MODULE_3>', '{...}'::jsonb, 'gemini-2.5-flash', 0.4, 1500, 'json_object'),
  ('summary_messages', 'summary', NULL, 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash-8b', 0.5, 400, 'text'),
  ('recommendation_short', 'recommendation', NULL, 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 300, 'text'),
  ('recommendation_long', 'recommendation', NULL, 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-pro', 0.6, 1500, 'text'),
  ('portrait_generation', 'portrait', 'portrait', 1, true, '<текст>', '{...}'::jsonb, 'gemini-2.5-flash', 0.7, 1500, 'json_object');
```

---

## Фаза 3: JSON-файлы констант

В `_legacy_web/data/`:

1. **`egyptian_terms.json`** — таблица египетских термов (MODULE_1 Приложение А).
2. **`chakra_states_baseline.json`** — базовые состояния (MODULE_3).
3. **`portrait_templates.json`** — ~300 шаблонов портрета (MODULE_3 Этап A1).
4. **`planet_chakra_map.json`** — соответствие планет и чакр.
5. **`information_axes.json`** — оси информации по use case (MODULE_4):
   ```json
   {
     "calibration": {
       "axes": {
         "positive_traits_described": { "weight": 0.3, "threshold": 0.6, "description": "..." },
         "challenges_described":      { "weight": 0.3, "threshold": 0.6, "description": "..." },
         "chakras_coverage":          { "weight": 0.4, "threshold": 0.5, "description": "..." }
       },
       "soft_cap": 4
     },
     "daily_dialog": {
       "axes": {
         "user_state":      { "weight": 0.3, "threshold": 0.6, "description": "..." },
         "context":         { "weight": 0.2, "threshold": 0.4, "description": "..." },
         "insight_offered": { "weight": 0.2, "threshold": 1.0, "description": "..." },
         "practice_intent": { "weight": 0.3, "threshold": 0.8, "description": "..." }
       },
       "soft_cap": 6
     }
   }
   ```

---

## Фаза 4: Backend endpoints

### 4.1. Структура

```
_legacy_web/app/api/
├── astro/
│   ├── natal/route.ts                    # POST: M1 — создать натальный профиль
│   └── daily-forecast/route.ts           # POST: M2 — получить прогноз дня
├── calibration/
│   ├── transcribe/route.ts               # POST: Groq Whisper-v3
│   ├── extract/route.ts                  # POST: M3 — извлечение дельт + усреднение
│   └── portrait/route.ts                 # POST: M3 — генерация портрета
├── communicator/
│   └── v2/
│       ├── transcribe/route.ts           # POST: Groq STT
│       ├── dialog/route.ts               # POST: оркестратор + responder + SSE
│       ├── greeting/route.ts             # POST: первый ход (вырожденный случай)
│       ├── select-practice/route.ts      # POST: детерминированный выбор
│       ├── correct-recommendation/route.ts # POST: корректировка
│       └── recommendation-text/route.ts  # POST: генерация текста
└── _utils/
    ├── auth.ts                           # JWT validation (через supabase.auth.getUser)
    ├── rateLimit.ts                      # Redis или in-memory
    ├── prompts.ts                        # render с переменными {{var}}
    ├── orchestrator.ts                   # вызов оркестратора + парсинг
    ├── responder.ts                      # вызов responder + SSE stream
    ├── markers.ts                        # парсинг [STATE_PROPOSAL: ...] и т.д.
    ├── groq.ts                           # обёртка для Groq
    └── gemini.ts                         # обёртка для Gemini
```

### 4.2. Удалить старый эндпоинт

```bash
rm _legacy_web/app/api/communicator/route.ts
```

### 4.3. Реализация ключевого endpoint /communicator/v2/dialog

Псевдокод:

```typescript
// _legacy_web/app/api/communicator/v2/dialog/route.ts
export async function POST(req: Request) {
  // 1. Authentication
  const userId = await validateJwt(req);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  
  // 2. Rate limiting
  await checkRateLimit(userId, "dialog", 10, 60);
  
  // 3. Parse body
  const { conversationId, useCase, entrySource, triggerMeta, userMessage, userTimezone } = await req.json();
  
  // 4. Load context
  const [conversation, calibration, forecast, history, profile] = await Promise.all([
    conversationId ? getConversation(conversationId) : createConversation(userId, useCase, entrySource, triggerMeta),
    getActiveCalibration(userId),
    getTodayForecast(userId),
    getMessageHistory(conversationId, 10),
    getUserProfile(userId)
  ]);
  
  // 5. Build orchestrator input
  const orchestratorPrompt = await getActivePrompt('orchestrator_decision');
  const phases = await getPhasesFor(useCase);
  const axes = require('@/data/information_axes.json')[useCase];
  const tod = timeOfDayContext(new Date(), userTimezone);
  
  // 6. ОПРЕДЕЛЕНИЕ DECISION — три ветки:
  let decision: OrchestratorDecision;
  const iterationNumber = history.length + 1;
  
  if (shouldBypassGreeting(history, conversationId)) {
    // 6a. Greeting bypass — первый ход, фаза детерминирована
    const phaseId = useCase === 'calibration' ? 'welcome_and_hint' : 'contextual_greeting';
    decision = {
      next_phase: phaseId,
      reasoning: 'Bypass: первый ход диалога, фаза детерминирована',
      information_completeness: {},
      information_density: 0,
      user_signals: [],
      should_close: false,
      responder_hints: {
        tone: tod.preferredTone,
        use_user_phrases: [],
        avoid_topics: []
      },
      decision_source: 'bypass_greeting',
      bypass_reason: history.length === 0 ? 'no_history' : 'null_conversation_id'
    };
    
  } else if (canReuseDecision(iterationNumber, history, userMessage)) {
    // 6b. Cache reuse — переиспользуем предыдущее решение
    const previousDecision = getLastOrchestratorDecision(history);
    const similarity = contextSimilarity(userMessage, getLastUserMessage(history), previousDecision);
    decision = {
      ...previousDecision,
      reasoning: `Reused: similarity ${similarity.toFixed(2)} > ${CACHE_THRESHOLD} at iter ${iterationNumber}`,
      information_density: estimateDensity(userMessage),
      user_signals: quickSignalDetection(userMessage),
      decision_source: 'cache_reused',
      cache_similarity: similarity,
      bypass_reason: undefined
    };
    
  } else {
    // 6c. Fresh orchestrator call
    const orchestratorOutput = await callGemini({
      prompt: renderPrompt(orchestratorPrompt.template, {
        use_case: useCase,
        available_phases: phases.map(p => `- ${p.phase_id}: ${p.description}`).join("\n"),
        information_axes: JSON.stringify(axes),
        time_of_day: tod.timeOfDay,
        local_hour: tod.localHour,
        time_of_day_hint: JSON.stringify(tod),
        iteration_number: iterationNumber,
        soft_cap: axes.soft_cap,
        user_profile_summary: buildProfileSummary(profile, calibration, forecast),
        conversation_history: formatHistory(history),
        user_message: userMessage
      }),
      model: orchestratorPrompt.model_hint,
      temperature: orchestratorPrompt.temperature,
      max_output_tokens: orchestratorPrompt.max_output_tokens,
      response_format: 'json_object'
    });
    decision = {
      ...parseOrchestratorDecision(orchestratorOutput),  // validate via zod
      decision_source: 'fresh'
    };
  }
  
  // Helper functions (определены отдельно):
  // 
  // function shouldBypassGreeting(history, conversationId) {
  //   if (!process.env.DIALOG_GREETING_BYPASS_ENABLED) return false;
  //   return conversationId == null || history.length === 0;
  // }
  // 
  // function canReuseDecision(iterationNumber, history, currentMessage) {
  //   if (!process.env.DIALOG_DECISION_CACHE_ENABLED) return false;
  //   const minIter = parseInt(process.env.DIALOG_DECISION_CACHE_MIN_ITERATION || '3');
  //   if (iterationNumber < minIter) return false;
  //   
  //   const previousDecision = getLastOrchestratorDecision(history);
  //   if (!previousDecision) return false;
  //   if (TERMINAL_PHASES.includes(previousDecision.next_phase)) return false;
  //   if (shouldForceFreshDecision(history)) return false;  // anti-stagnation
  //   
  //   const previousUserMessage = getLastUserMessage(history);
  //   const threshold = parseFloat(process.env.DIALOG_DECISION_CACHE_THRESHOLD || '0.8');
  //   const similarity = contextSimilarity(currentMessage, previousUserMessage, previousDecision);
  //   return similarity > threshold;
  // }
  
  // 7. Save user message
  await saveMessage({ conversationId, role: 'user', content: userMessage });
  
  // 8. If silent phase — нет ответа
  const phase = phases.find(p => p.phase_id === decision.next_phase);
  if (phase.is_silent) {
    return Response.json({ phase: phase.phase_id, no_response: true });
  }
  
  // 9. Call responder (streaming)
  const phasePrompt = await getActivePrompt(phase.prompt_key);
  const responderSystemPrompt = await getActivePrompt('responder_main');
  
  const stream = new ReadableStream({
    async start(controller) {
      // Send orchestrator decision
      controller.enqueue(formatSSE('orchestrator_decision', decision));
      
      let fullText = '';
      const responderStream = await callGeminiStream({
        prompt: renderPrompt(responderSystemPrompt.template, {
          current_phase: phase.phase_id,
          phase_instruction: renderPrompt(phasePrompt.template, buildPhaseVariables(...)),
          tone: decision.responder_hints?.tone || 'neutral',
          style_markers: calibration?.user_lexicon.style_markers,
          user_phrases: getRelevantPhrases(calibration, forecast),
          use_user_phrases: decision.responder_hints?.use_user_phrases || [],
          avoid_topics: decision.responder_hints?.avoid_topics || [],
          user_profile_summary: buildProfileSummary(...),
          daily_context: useCase === 'daily_dialog' ? buildDailyContext(forecast) : ''
        }),
        history: history.map(m => ({ role: m.role, content: m.content })),
        userMessage,
        model: phasePrompt.model_hint
      });
      
      for await (const chunk of responderStream) {
        fullText += chunk;
        controller.enqueue(formatSSE('chunk', { text: chunk }));
      }
      
      // 10. Parse markers
      const markers = parseResponseMarkers(fullText);
      const cleanText = stripMarkers(fullText);
      
      // 11. Handle markers
      if (markers.state_proposals?.length) {
        await saveStateProposals(userId, conversationId, markers.state_proposals);
      }
      if (markers.practice_pick) {
        await registerPracticePick(userId, conversationId, markers.practice_pick);
      }
      if (markers.correct_recommendation) {
        await applyRecommendationCorrection(userId, markers.correct_recommendation);
      }
      
      // 12. Save assistant message with full meta
      const messageId = await saveMessage({
        conversationId,
        role: 'assistant',
        content: cleanText,
        meta: {
          use_case: useCase,
          orchestrator_decision: decision,
          responder: {
            phase_used: phase.phase_id,
            extracted_states: markers.state_proposals?.map(p => p.label) || [],
            ai_state_proposals: markers.state_proposals || [],
            tokens_used: { input: ..., output: ... },
            model_used: phasePrompt.model_hint
          }
        }
      });
      
      // 13. Send complete event
      controller.enqueue(formatSSE('complete', {
        messageId,
        fullText: cleanText,
        shouldClose: phase.is_terminal || decision.should_close,
        practicePicked: markers.practice_pick,
        recommendationCorrected: markers.correct_recommendation
      }));
      
      // 14. If closing — trigger summarization
      if (phase.is_terminal || decision.should_close) {
        await triggerConversationSummary(conversationId);
      }
      
      controller.close();
    }
  });
  
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  });
}
```

### 4.4. Переменные окружения

```
# LLM
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ_...
SUPABASE_SERVICE_ROLE_KEY=eyJ_...

# Rate limiting
REDIS_URL=redis://localhost:6379          # опционально, иначе in-memory

# Dialogue Engine оптимизации (могут отключаться для отладки)
DIALOG_GREETING_BYPASS_ENABLED=true       # пропускать оркестратор на первом ходу
DIALOG_DECISION_CACHE_ENABLED=true        # переиспользовать decision при стабильном контексте
DIALOG_DECISION_CACHE_MIN_ITERATION=3     # минимальный номер хода для cache lookup
DIALOG_DECISION_CACHE_THRESHOLD=0.8       # similarity порог для cache hit (0..1)
```

Удалить (если есть): `GOOGLE_AI_API_KEY` (дубликат).

---

## Фаза 5: Frontend изменения

### 5.1. Удалить файлы

```bash
rm modules/communicator/core/transcript-parser.ts
```

### 5.2. Переписать services/communicator-client.ts

Без принципиальных изменений из предыдущего плана, но добавить парсинг события `orchestrator_decision`:

```typescript
export async function sendDialogMessage(params: {
  conversationId: string | null;
  useCase: 'calibration' | 'daily_dialog';
  entrySource: string;
  triggerMeta: any;
  userMessage: string;
  userTimezone: string;
  onOrchestratorDecision: (decision: OrchestratorDecision) => void;
  onChunk: (text: string) => void;
  onComplete: (result: DialogResult) => void;
}): Promise<void> {
  // SSE парсинг — обрабатываем три типа событий:
  // - orchestrator_decision (для debug-инспектора)
  // - chunk (стриминг ответа)
  // - complete (финальные данные)
}
```

### 5.3. Создать новые модули

```
modules/
├── astro-core/                          # M1
│   ├── index.ts
│   ├── computeNatalProfile.ts
│   ├── essentialDignity.ts
│   ├── accidentalDignity.ts
│   ├── harmoniousness.ts
│   ├── ephemeris.ts
│   └── data/
│       ├── egyptian_terms.json
│       └── essential_dignities.json
├── daily-engine/                        # M2
│   ├── index.ts
│   ├── computeDailyForecast.ts
│   ├── activation.ts
│   ├── importance.ts
│   ├── windowsOfOpportunity.ts
│   └── chooseFinalPlanet.ts
└── communicator/
    ├── core/
    │   ├── audioMime.ts                # ОСТАЁТСЯ
    │   └── transcript-parser.ts        # УДАЛИТЬ
    ├── DialogEngine.ts                 # клиентская обёртка над dialog API
    └── ...
```

### 5.4. UI Communicator

Ключевое изменение: индикатор «думаю» во время вызова оркестратора (~500мс) и потом стриминг от responder.

```typescript
async function handleVoiceMessage(audioUri: string) {
  setStatus("transcribing");
  const { text, confidence } = await transcribeAudio(audioUri);
  
  if (confidence < 0.6) {
    const edited = await showEditDialog(text);
    if (!edited) return;
    text = edited;
  }
  
  addMessage({ role: "user", content: text });
  setStatus("thinking");  // показываем индикатор пока оркестратор решает
  
  let assistantText = "";
  const messageId = generateUUID();
  
  await sendDialogMessage({
    conversationId, useCase, entrySource, triggerMeta,
    userMessage: text,
    userTimezone: getUserTimezone(),
    
    onOrchestratorDecision: (decision) => {
      // Можно использовать для debug, не показывается пользователю
      console.debug('Orchestrator:', decision);
      setStatus("typing");
      addMessage({ id: messageId, role: "assistant", content: "" });
    },
    
    onChunk: (chunk) => {
      assistantText += chunk;
      updateMessage(messageId, assistantText);
    },
    
    onComplete: (result) => {
      if (result.shouldClose) {
        setStatus("closing");
        if (result.practicePicked) {
          showPracticeCard(result.practicePicked);
        }
      }
      setStatus("idle");
    }
  });
}
```

---

## Фаза 6: Главный экран

См. отдельный документ или HTML-стенд.

---

## Фаза 7: Cron jobs

```
supabase/functions/
├── auto-calibrate/                       # каждый день в 03:00 UTC
│   └── index.ts
├── precompute-daily-forecasts/           # ежечасно (для разных TZ)
│   └── index.ts
└── cleanup-expired-proposals/            # раз в неделю
    └── index.ts
```

---

## Фаза 8: Тестирование

См. тестовые сценарии в MODULE_1, MODULE_2, MODULE_3, MODULE_4.

Дополнительно для Orchestrator:

**Тест: «Болтливый vs молчаливый»**
- Один и тот же `phase_welcome_and_hint` в калибровке.
- Тест 1: пользователь даёт 4-минутный плотный ответ → orchestrator выбирает acknowledge_and_close (1 итерация).
- Тест 2: пользователь говорит «не знаю, всё ок» → orchestrator выбирает deepen_specific_chakra → потом снова listen_user → потом close после 3 итераций.

**Тест: «Time of day влияние»**
- Один и тот же запрос в 08:00 и 22:00.
- В 08:00 — orchestrator с tone=energising, preferredPracticeKinds=[asanas, pranayama].
- В 22:00 — tone=calming, preferredPracticeKinds=[meditation].

---

## Фаза 9: Подготовка к продакшену

1. Sentry для логирования ошибок.
2. PostHog/Amplitude для метрик (особенно: оркестратор decisions distribution, средняя длина диалога, conversion в практику).
3. Алерт на превышение бюджета LLM.
4. A/B-тесты разных оркестратор-промптов: можно запускать через `is_active` flag в `prompts` — для разных групп пользователей.

---

## Порядок выполнения для Cursor

1. **Фаза 1** (миграции БД).
2. **Фаза 3** (JSON-файлы).
3. **Фаза 5.3** (новые frontend модули M1, M2 — независимы от LLM).
4. **Фаза 4** (backend endpoints) — параллельно.
5. **Фаза 2** (seed промптов) — после создания таблиц.
6. **Фаза 5.1, 5.2, 5.4** (миграция Communicator).
7. **Фаза 6** (главный экран).
8. **Фаза 7** (cron).
9. **Фаза 8** (тесты на каждом этапе).

---

## Что НЕ нужно делать

- Не удалять `chakras`, `practices`, `practice_chakras`, `messages`, `conversations`.
- Не создавать `home_screen_blocks` (используем `user_settings.preferences`).
- Не дублировать `practices` под `yoga_practices`.
- Не выносить `audio_url` в отдельную таблицу.
- Не создавать voice_sessions.
- Не реализовывать multi-agent (одного оркестратора достаточно для MVP).
- Не реализовывать adaptive model selection (модель в `prompts.model_hint`).
