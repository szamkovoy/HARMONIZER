# PATCH 12 [P0]: Scenarios Architecture — Расширяемая система типов общения

## Что это решает

Сейчас в коде явно прописаны только два типа взаимодействия с ИИ:
- `useCase = "calibration"` — диалог калибровки
- `useCase = "daily_dialog"` — обсуждение рекомендации

Но в приложении есть **5 разных точек** работы ИИ:
1. Психологический портрет (монолог)
2. Текст рекомендаций на день (монолог)
3. Слоган дня (монолог)
4. Обсуждение рекомендаций (диалог)
5. Развёрнутые объяснения (монолог)

И в будущем будут новые: «диалог по геомагнитному фону», «вечерняя рефлексия», «обсуждение календаря экадаши»...

Если оставить как сейчас — каждый новый сценарий потребует правок в коде в 5-7 местах. Этот патч вводит **`scenarios` table** — единый реестр всех сценариев общения, где каждый описан декларативно: ID, тип (monologue/dialogue), use_case, подключённые промпты. **Добавление нового сценария = одна запись в БД, ноль строк кода.**

## Эффект

После применения:
- Все 5 точек общения объединены под единой архитектурой.
- Добавление нового типа общения занимает 10 минут (вставить запись в БД + создать промпт).
- Ясное разделение **monologue endpoints** (один LLM-запрос, без оркестратора) и **dialogue endpoints** (полный orchestrator+responder pipeline).

---

## 1. SQL-миграция

```sql
-- supabase/migrations/<timestamp>_scenarios_architecture.sql

-- =============================================
-- 1. Таблица scenarios — реестр всех сценариев
-- =============================================
CREATE TABLE public.scenarios (
  id text PRIMARY KEY,                         -- "morning_recommendation", "psychological_portrait", "daily_dialog"
  scenario_type text NOT NULL CHECK (scenario_type IN ('monologue', 'dialogue')),
  
  display_name jsonb NOT NULL,                 -- { "ru": "Утренняя рекомендация", "en": "Morning recommendation" }
  description text,
  
  -- Для monologue: ссылка на единственный промпт
  monologue_prompt_key text,
  
  -- Для dialogue: какие use_case в dialogue_phases используются
  dialogue_use_case text,
  
  -- Параметры запроса к LLM (для monologue)
  output_schema jsonb,                          -- JSON-schema ожидаемого ответа от LLM
  cache_strategy text CHECK (cache_strategy IN ('per_user_per_day', 'per_user_per_calibration', 'no_cache')) DEFAULT 'no_cache',
  
  is_active boolean NOT NULL DEFAULT true,
  display_order integer DEFAULT 100,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenarios_active ON public.scenarios(scenario_type) WHERE is_active = true;

-- RLS — service role работает свободно, чтения админам
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY scenarios_admin_all ON public.scenarios FOR ALL USING (is_admin(auth.uid()));
CREATE POLICY scenarios_authenticated_read ON public.scenarios FOR SELECT USING (auth.uid() IS NOT NULL);

-- =============================================
-- 2. Seed: текущие сценарии
-- =============================================
INSERT INTO public.scenarios (id, scenario_type, display_name, description, monologue_prompt_key, dialogue_use_case, output_schema, cache_strategy, display_order) VALUES

-- MONOLOGUE сценарии
(
  'psychological_portrait', 'monologue',
  '{"ru": "Психологический портрет", "en": "Psychological portrait"}'::jsonb,
  'Генерируется один раз после ввода натальной карты. Используется только для калибровки.',
  'monologue_psychological_portrait',
  NULL,
  '{"type": "object", "properties": {"portrait": {"type": "string"}, "portrait_chunks": {"type": "object"}}, "required": ["portrait"]}'::jsonb,
  'no_cache',
  10
),
(
  'morning_recommendation', 'monologue',
  '{"ru": "Утренняя рекомендация", "en": "Morning recommendation"}'::jsonb,
  'Генерируется одним запросом: слоган + короткий текст + развёрнутое объяснение.',
  'monologue_morning_recommendation',
  NULL,
  '{"type": "object", "properties": {"slogan": {"type": "string", "maxLength": 80}, "short_text": {"type": "string"}, "long_explanation": {"type": "string"}}, "required": ["slogan", "short_text", "long_explanation"]}'::jsonb,
  'per_user_per_day',
  20
),
(
  'deep_explanation', 'monologue',
  '{"ru": "Развёрнутое объяснение дня", "en": "Deep day explanation"}'::jsonb,
  'Объясняет астрологическую механику дня для интересующихся пользователей.',
  'monologue_deep_explanation',
  NULL,
  '{"type": "object", "properties": {"explanation": {"type": "string"}}, "required": ["explanation"]}'::jsonb,
  'per_user_per_day',
  30
),

-- DIALOGUE сценарии
(
  'calibration', 'dialogue',
  '{"ru": "Калибровка профиля", "en": "Profile calibration"}'::jsonb,
  'Голосовой диалог калибровки силы и гармоничности планет на основе натальной карты.',
  NULL,
  'calibration',
  NULL,
  'no_cache',
  100
),
(
  'daily_dialog', 'dialogue',
  '{"ru": "Обсуждение дня", "en": "Day discussion"}'::jsonb,
  'Голосовой диалог обсуждения рекомендации дня и подбора практики.',
  NULL,
  'daily_dialog',
  NULL,
  'no_cache',
  110
);

-- =============================================
-- 3. Расширение conversations.entry_source
-- =============================================
-- Добавляем поле scenario_id для явной связи диалога со сценарием
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS scenario_id text REFERENCES public.scenarios(id);

CREATE INDEX IF NOT EXISTS idx_conversations_scenario ON public.conversations(scenario_id);

-- =============================================
-- 4. Триггер обновления updated_at
-- =============================================
CREATE TRIGGER scenarios_set_updated_at
BEFORE UPDATE ON public.scenarios
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
```

---

## 2. TypeScript-типизация

```typescript
// _legacy_web/app/api/_utils/scenarios.ts

import { createServiceSupabase } from "./supabase";

export type ScenarioType = "monologue" | "dialogue";
export type CacheStrategy = "per_user_per_day" | "per_user_per_calibration" | "no_cache";

export interface Scenario {
  id: string;
  scenario_type: ScenarioType;
  display_name: Record<string, string>;
  description?: string;
  
  monologue_prompt_key?: string;
  dialogue_use_case?: string;
  
  output_schema?: any;
  cache_strategy: CacheStrategy;
  is_active: boolean;
}

/**
 * Загружает сценарий по ID. Использует in-memory cache на 60 секунд.
 */
const scenarioCache = new Map<string, { scenario: Scenario; expiresAt: number }>();
const SCENARIO_CACHE_TTL_MS = 60_000;

export async function getScenario(scenarioId: string): Promise<Scenario | null> {
  const cached = scenarioCache.get(scenarioId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.scenario;
  }
  
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("scenarios")
    .select("*")
    .eq("id", scenarioId)
    .eq("is_active", true)
    .single();
  
  if (error || !data) return null;
  
  scenarioCache.set(scenarioId, {
    scenario: data as Scenario,
    expiresAt: Date.now() + SCENARIO_CACHE_TTL_MS,
  });
  
  return data as Scenario;
}

export async function listScenarios(type?: ScenarioType): Promise<Scenario[]> {
  const supabase = createServiceSupabase();
  let query = supabase
    .from("scenarios")
    .select("*")
    .eq("is_active", true)
    .order("display_order");
  
  if (type) query = query.eq("scenario_type", type);
  
  const { data } = await query;
  return (data ?? []) as Scenario[];
}
```

---

## 3. Унифицированные эндпоинты

Вместо текущей россыпи endpoints — **два universal endpoint**, которые работают по `scenario_id`:

### `/api/ai/monologue` — для всех монологов

```typescript
// _legacy_web/app/api/ai/monologue/route.ts

import { NextRequest, NextResponse } from "next/server";
import { validateJwt } from "@/app/api/_utils/auth";
import { getScenario } from "@/app/api/_utils/scenarios";
import { getActivePrompt, renderPrompt } from "@/app/api/_utils/prompts";
import { generateGeminiJson } from "@/app/api/_utils/gemini";
import { createServiceSupabase } from "@/app/api/_utils/supabase";
import { checkCache, saveToCache } from "@/app/api/_utils/scenarioCache";

export async function POST(req: NextRequest) {
  const userId = await validateJwt(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const body = await req.json();
  const { scenario_id, variables = {} } = body;
  
  if (!scenario_id) {
    return NextResponse.json({ error: "scenario_id is required" }, { status: 400 });
  }
  
  // 1. Загружаем сценарий
  const scenario = await getScenario(scenario_id);
  if (!scenario) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  
  if (scenario.scenario_type !== "monologue") {
    return NextResponse.json({ 
      error: "This endpoint is for monologue scenarios. Use /api/ai/dialog for dialogues." 
    }, { status: 400 });
  }
  
  // 2. Проверяем кеш
  const cached = await checkCache(scenario, userId);
  if (cached) {
    return NextResponse.json({ 
      ...cached, 
      cached: true,
      scenario_id 
    });
  }
  
  // 3. Загружаем промпт
  if (!scenario.monologue_prompt_key) {
    return NextResponse.json({ error: "Scenario has no prompt configured" }, { status: 500 });
  }
  
  const prompt = await getActivePrompt(scenario.monologue_prompt_key);
  if (!prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 500 });
  }
  
  // 4. Рендерим переменные
  const rendered = renderPrompt(prompt.template, variables);
  
  // 5. Вызываем Gemini
  const result = await generateGeminiJson({
    prompt: rendered,
    model: prompt.model_hint ?? "gemini-2.5-flash",
    temperature: prompt.temperature ?? 0.7,
    maxTokens: prompt.max_output_tokens ?? 1024,
  });
  
  // 6. Валидируем по schema (опционально)
  // ...
  
  // 7. Сохраняем в кеш
  await saveToCache(scenario, userId, result);
  
  return NextResponse.json({ 
    ...result, 
    cached: false,
    scenario_id 
  });
}
```

### `/api/ai/dialog` — для всех диалогов

Это переименованный текущий `/api/communicator/v2/dialog` с поддержкой `scenario_id` вместо хардкоженных `useCase`.

```typescript
// _legacy_web/app/api/ai/dialog/route.ts (вместо /communicator/v2/dialog)

export async function POST(req: NextRequest) {
  const userId = await validateJwt(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const body = await req.json();
  const { 
    scenario_id, 
    conversationId, 
    entrySource, 
    triggerMeta, 
    userMessage, 
    userTimezone 
  } = body;
  
  // Загружаем сценарий
  const scenario = await getScenario(scenario_id);
  if (!scenario || scenario.scenario_type !== "dialogue") {
    return NextResponse.json({ 
      error: "Invalid scenario for dialog endpoint" 
    }, { status: 400 });
  }
  
  if (!scenario.dialogue_use_case) {
    return NextResponse.json({ 
      error: "Scenario has no use_case configured" 
    }, { status: 500 });
  }
  
  // Дальше — текущая логика, где useCase = scenario.dialogue_use_case
  const useCase = scenario.dialogue_use_case;
  
  // ... остальной код dialog/route.ts как есть, только используем useCase из сценария
}
```

### Старый endpoint `/api/communicator/v2/dialog` — оставляем как proxy (для обратной совместимости)

```typescript
// _legacy_web/app/api/communicator/v2/dialog/route.ts

// Этот endpoint остаётся работать, но добавляем deprecation warning в logs.
// Маппинг useCase → scenario_id:
const USE_CASE_TO_SCENARIO: Record<string, string> = {
  "calibration": "calibration",
  "daily_dialog": "daily_dialog",
};

export async function POST(req: NextRequest) {
  console.warn("[DEPRECATED] /api/communicator/v2/dialog is deprecated. Use /api/ai/dialog with scenario_id.");
  
  const body = await req.json();
  if (body.useCase && !body.scenario_id) {
    body.scenario_id = USE_CASE_TO_SCENARIO[body.useCase];
  }
  
  // Перенаправляем в новый endpoint
  // (либо просто вызываем ту же handler-функцию, что и /ai/dialog)
}
```

---

## 4. Кеш сценариев

```typescript
// _legacy_web/app/api/_utils/scenarioCache.ts

import { createServiceSupabase } from "./supabase";
import { Scenario } from "./scenarios";
import { todayLocalDate, getUserTimezone } from "./timezone";

interface CachedResult {
  scenario_id: string;
  user_id: string;
  cache_key: string;     // вычисляется из стратегии
  data: any;
  created_at: string;
  expires_at?: string;
}

/**
 * Вычисляет cache_key для сценария.
 * Например, для per_user_per_day = "morning_recommendation:userid:2026-04-29"
 */
async function buildCacheKey(scenario: Scenario, userId: string): Promise<string> {
  const supabase = createServiceSupabase();
  
  switch (scenario.cache_strategy) {
    case "per_user_per_day": {
      const userTz = await getUserTimezone(supabase, userId);
      const today = todayLocalDate(userTz);
      return `${scenario.id}:${userId}:${today}`;
    }
    case "per_user_per_calibration": {
      const { data } = await supabase
        .from("user_calibrations")
        .select("version")
        .eq("user_id", userId)
        .eq("is_active", true)
        .single();
      const version = data?.version ?? 0;
      return `${scenario.id}:${userId}:cal_v${version}`;
    }
    case "no_cache":
      return null;  // не кешируем
    default:
      return null;
  }
}

export async function checkCache(scenario: Scenario, userId: string): Promise<any | null> {
  if (scenario.cache_strategy === "no_cache") return null;
  
  const cacheKey = await buildCacheKey(scenario, userId);
  if (!cacheKey) return null;
  
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("scenario_cache")
    .select("data")
    .eq("cache_key", cacheKey)
    .single();
  
  return data?.data ?? null;
}

export async function saveToCache(scenario: Scenario, userId: string, data: any): Promise<void> {
  if (scenario.cache_strategy === "no_cache") return;
  
  const cacheKey = await buildCacheKey(scenario, userId);
  if (!cacheKey) return;
  
  const supabase = createServiceSupabase();
  await supabase
    .from("scenario_cache")
    .upsert({
      cache_key: cacheKey,
      scenario_id: scenario.id,
      user_id: userId,
      data,
      created_at: new Date().toISOString(),
    });
}
```

И таблица в той же миграции:

```sql
CREATE TABLE public.scenario_cache (
  cache_key text PRIMARY KEY,
  scenario_id text NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_cache_user ON public.scenario_cache(user_id, scenario_id);

ALTER TABLE public.scenario_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY cache_select_own ON public.scenario_cache FOR SELECT USING (user_id = auth.uid());
-- INSERT/UPDATE/DELETE — только service_role.
```

---

## 5. Как добавлять новые сценарии

После применения этого патча, **добавить новый сценарий = вставить запись**:

```sql
-- Пример: новый сценарий "evening_reflection"
INSERT INTO public.scenarios (id, scenario_type, display_name, monologue_prompt_key, cache_strategy) 
VALUES (
  'evening_reflection',
  'monologue',
  '{"ru": "Вечерняя рефлексия", "en": "Evening reflection"}'::jsonb,
  'monologue_evening_reflection',
  'per_user_per_day'
);

-- Создать промпт
INSERT INTO public.prompts (prompt_key, prompt_type, version, is_active, template, ...) VALUES (
  'monologue_evening_reflection', 'recommendation', 1, true, '<TEMPLATE>...', ...
);
```

И всё. Никаких изменений в коде. Endpoint `/api/ai/monologue` подхватит новый сценарий автоматически.

Для нового **диалогового** сценария (например, «диалог про геомагнитный фон»):

```sql
INSERT INTO public.scenarios (id, scenario_type, display_name, dialogue_use_case)
VALUES (
  'geomagnetic_dialog',
  'dialogue',
  '{"ru": "Обсуждение геомагнитного фона"}'::jsonb,
  'geomagnetic_dialog'
);

-- Создать фазы для нового use_case
INSERT INTO public.dialogue_phases (use_case, phase_id, prompt_key, ...) VALUES
  ('geomagnetic_dialog', 'greeting', 'phase_geo_greeting', ...),
  ('geomagnetic_dialog', 'collect', 'phase_geo_collect', ...),
  ...

-- Создать промпты для фаз
INSERT INTO public.prompts ...
```

---

## 6. Frontend изменения

```typescript
// services/aiClient.ts

export async function callMonologue(scenarioId: string, variables: any) {
  const jwt = await getSupabaseJwt();
  const res = await fetch(`${API_URL}/api/ai/monologue`, {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${jwt}`, 
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({ scenario_id: scenarioId, variables }),
  });
  return res.json();
}

// Использование на главной странице (для morning_recommendation):
const morningContent = await callMonologue("morning_recommendation", {
  user_name: user.name,
  planet_of_day: forecast.planet_of_the_day,
  chakra_label: forecast.chakra_label,
  is_harmonic: forecast.today_planet_state.todayTone !== "dissonant",
  user_phrases_for_chakra: getUserPhrasesForChakra(calibration, forecast.planet_of_the_day),
  baseline_states: getBaselineStatesForChakra(forecast.planet_of_the_day),
  address_form: user.address_form,
});

// На главной странице:
// - morningContent.slogan → в верхний баннер
// - morningContent.short_text → в блок рекомендации
// - morningContent.long_explanation → в модальное окно при нажатии иконки
```

---

## 7. Тесты

```typescript
// _legacy_web/app/api/_utils/scenarios.test.ts

describe("getScenario", () => {
  it("returns active scenario by id", async () => {
    const scenario = await getScenario("morning_recommendation");
    expect(scenario).toBeDefined();
    expect(scenario.scenario_type).toBe("monologue");
    expect(scenario.cache_strategy).toBe("per_user_per_day");
  });
  
  it("returns null for unknown scenario", async () => {
    const scenario = await getScenario("nonexistent_scenario");
    expect(scenario).toBeNull();
  });
  
  it("returns null for inactive scenario", async () => {
    // Pre-condition: deactivate test scenario
    const scenario = await getScenario("test_inactive");
    expect(scenario).toBeNull();
  });
});

describe("scenario cache", () => {
  it("returns null for no_cache strategy", async () => {
    const noCache = { 
      id: "test", 
      cache_strategy: "no_cache" as const, 
      // ...
    };
    expect(await checkCache(noCache, "user1")).toBeNull();
  });
  
  it("uses local date for per_user_per_day strategy", async () => {
    // Тест проверяет, что cache_key учитывает timezone пользователя
    // ...
  });
  
  it("invalidates cache when calibration version changes", async () => {
    // Тест: меняем версию калибровки → старый cached не возвращается
    // ...
  });
});

describe("/api/ai/monologue endpoint", () => {
  it("returns 400 if scenario_id missing", async () => {
    // ...
  });
  
  it("returns 400 if scenario_type is dialogue", async () => {
    // calibration сценарий нельзя через monologue endpoint
    // ...
  });
  
  it("returns cached result on second call", async () => {
    // Первый вызов → cached: false
    // Второй вызов → cached: true
    // ...
  });
});
```

---

## Прогноз эффекта

| Параметр | До | После |
|---|---|---|
| Кол-во endpoints для AI | 7+ разных | 2 универсальных (+ legacy proxy) |
| Время добавления нового сценария | 2-3 часа кода | 10 минут SQL |
| Дублирование кода LLM-вызовов | в каждом endpoint | один общий генератор |
| Видимость всех сценариев | в коде | в БД (можно админка) |
| Кеширование | хардкод per endpoint | per scenario через стратегии |
| Onboarding нового разработчика | сложный | посмотрел `scenarios` table — всё ясно |

---

## Критерий приёмки

- ✅ Таблица `scenarios` создана и наполнена 5 сценариями.
- ✅ Таблица `scenario_cache` создана.
- ✅ Создан `_utils/scenarios.ts` с `getScenario()`, `listScenarios()`.
- ✅ Создан `_utils/scenarioCache.ts` с тремя стратегиями.
- ✅ Endpoint `/api/ai/monologue` работает.
- ✅ Endpoint `/api/ai/dialog` работает (переименованный текущий).
- ✅ Старый `/api/communicator/v2/dialog` оставлен как deprecated proxy.
- ✅ Frontend имеет helper `callMonologue(scenarioId, vars)`.
- ✅ Все unit/integration тесты проходят.
