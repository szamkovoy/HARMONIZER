# PATCH 14 [P0]: Free Tier — общие рекомендации для бесплатных пользователей

> **Версия:** 1
> **Зависимости:** PATCH 12 (Scenarios), PATCH 13 (Monologue Prompts) — уже применены
> **Цель:** разделение функциональности на платный (индивидуальный по натальной карте) и бесплатный (общий по транзитам).

## Что решает

Сейчас в коде все рекомендации генерируются индивидуально по натальной карте. Это:
1. Дорого по токенам (LLM-вызов на каждого активного пользователя ежедневно).
2. Не подходит для бесплатного тарифа без натальной карты.

Этот патч даёт:
- **Общие рекомендации** — генерируются раз в сутки на день вперёд для всех бесплатных пользователей. Опираются только на положение планет в этот день, без натальной карты пользователя.
- **Окна возможностей на клиенте** — для медленных планет считаются на основе общих транзитов, для Луны вычисляются на устройстве.
- **Типы тарифов в users** — поле `tier` определяет, какой источник данных использовать.

## Архитектурный принцип

```
                    ┌──────────────────────────────────────────────┐
                    │ Cron precompute-global-recommendations       │
                    │ (раз в сутки в 00:00 UTC, готовит на день+1) │
                    └────────────────────┬─────────────────────────┘
                                         │
                                         ↓
                    ┌──────────────────────────────────────────────┐
                    │ public.global_daily_content                  │
                    │ (одна запись на forecast_date_utc, общая      │
                    │ для всех бесплатных пользователей)            │
                    └────────────────────┬─────────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                                                 │
        ↓                                                                 ↓
┌──────────────────┐                                            ┌──────────────────┐
│ FREE USER        │                                            │ PAID USER        │
│ Reads global_    │                                            │ Reads/computes   │
│ daily_content    │                                            │ user_daily_      │
│ for their local  │                                            │ forecasts        │
│ date             │                                            │ (individual)     │
│                  │                                            │                  │
│ Computes window  │                                            │ Computes all     │
│ of opportunity   │                                            │ on client side   │
│ on client        │                                            │ (or backend for  │
│                  │                                            │ Sun/Sat — see    │
│                  │                                            │ next patches)    │
└──────────────────┘                                            └──────────────────┘
```

---

## 1. Миграция БД

### 1.1. Поле tier в users

```sql
-- supabase/migrations/<timestamp>_add_user_tier.sql

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free' 
  CHECK (tier IN ('free', 'trial', 'paid'));

COMMENT ON COLUMN public.users.tier IS 
'User subscription tier. free=общие рекомендации, trial=платный 3 дня, paid=индивидуальный.';

-- Поле для перехода в trial → free
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_tier ON public.users(tier);
CREATE INDEX IF NOT EXISTS idx_users_trial_expires ON public.users(trial_expires_at) 
  WHERE tier = 'trial';
```

### 1.2. Таблица global_daily_content

```sql
CREATE TABLE public.global_daily_content (
  forecast_date_utc date PRIMARY KEY,
  
  -- Положение планет на день (UTC 12:00 — момент расчёта)
  planet_positions jsonb NOT NULL,  -- { Sun: { lon: 180.5, sign: "Libra" }, ... }
  
  -- Главная активная планета дня (по транзитному взаимодействию между планетами)
  primary_planet text NOT NULL,
  primary_chakra_number int NOT NULL,
  primary_tone text NOT NULL CHECK (primary_tone IN ('harmonic', 'dissonant', 'ambivalent_strong')),
  
  -- Топ-3 лепестка для общего контекста (та же структура что в PATCH 13)
  top_petals jsonb NOT NULL,
  
  -- LLM-сгенерированный контент (одинаковый для всех free)
  slogan text NOT NULL,
  short_text text NOT NULL,
  long_explanation text NOT NULL,
  
  -- Math-level (можно показать всем кто заинтересуется)
  math_level jsonb NOT NULL,
  
  -- Метаданные
  generated_at timestamptz NOT NULL DEFAULT now(),
  llm_tokens_used int,
  llm_model text,
  
  -- Срок жизни записи: до момента, пока эта дата не прошла во ВСЕХ часовых поясах
  expires_at_utc timestamptz NOT NULL
);

-- Индекс для cron-чистки старых записей
CREATE INDEX idx_global_daily_content_expires ON public.global_daily_content(expires_at_utc);

-- RLS — все аутентифицированные читают, пишет только service role
ALTER TABLE public.global_daily_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY global_content_select_all ON public.global_daily_content
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- INSERT/UPDATE — только service_role (cron-функция)
```

### 1.3. Логика expires_at_utc

День `2026-04-29` существует в каком-то часовом поясе с момента `2026-04-28T10:00:00Z` (Гавайи UTC-14, начало 29-го) до `2026-04-29T14:00:00Z` (Кирибати UTC+14, конец 29-го).

`expires_at_utc` = `forecast_date_utc + 1 день + 14 часов`. То есть запись `2026-04-29` в БД до `2026-04-30T14:00:00Z`. После — её можно удалить через cron.

```typescript
// helper для cron
function calcExpiresAt(forecastDateUtc: string): string {
  const d = new Date(forecastDateUtc + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);  // следующий день
  d.setUTCHours(14, 0, 0, 0);         // 14:00 UTC = конец дня в UTC+14 (Кирибати)
  return d.toISOString();
}
```

---

## 2. Cron-функция precompute-global-recommendations

```typescript
// supabase/functions/precompute-global-recommendations/index.ts

import { createServiceClient, assertCronSecret } from "../_shared/supabase.ts";
import { computeGlobalDailyForecast } from "../_shared/globalDailyForecast.ts";
import { generateGeminiJson } from "../_shared/gemini.ts";
import { CONTENT_LENGTHS } from "../_shared/contentLengths.ts";

/**
 * Cron: каждый день в 00:00 UTC.
 * Готовит global_daily_content для дня UTC+1 (т.е. дня, который скоро 
 * наступит для самых восточных пользователей).
 */
Deno.serve(async (req) => {
  await assertCronSecret(req);
  
  const supabase = createServiceClient();
  
  // Готовим на 2 дня: текущий UTC-день (на случай если cron упал) + следующий
  const now = new Date();
  const today = isoDate(now);
  const tomorrow = isoDate(addDays(now, 1));
  
  const results = [];
  for (const date of [today, tomorrow]) {
    // Проверяем, есть ли уже запись
    const { data: existing } = await supabase
      .from("global_daily_content")
      .select("forecast_date_utc")
      .eq("forecast_date_utc", date)
      .maybeSingle();
    
    if (existing) {
      results.push({ date, status: "already_exists" });
      continue;
    }
    
    try {
      // 1. Считаем общий прогноз (без натальной карты пользователя)
      const forecast = await computeGlobalDailyForecast(date);
      
      // 2. Загружаем активный промпт global_morning_recommendation
      const { data: prompt } = await supabase
        .from("prompts")
        .select("template, model_hint, temperature, max_output_tokens")
        .eq("prompt_key", "global_morning_recommendation")
        .eq("is_active", true)
        .single();
      
      // 3. Готовим переменные для LLM
      const variables = buildGlobalPromptVariables(forecast);
      const renderedPrompt = renderTemplate(prompt.template, variables);
      
      // 4. Вызов LLM
      const llmResult = await generateGeminiJson({
        prompt: renderedPrompt,
        model: prompt.model_hint ?? "gemini-2.5-flash",
        temperature: prompt.temperature ?? 0.85,
        maxTokens: prompt.max_output_tokens ?? 2200,
      });
      
      // 5. Math level (детерминированно)
      const mathLevel = buildGlobalMathLevel(forecast);
      
      // 6. Сохранение
      await supabase.from("global_daily_content").insert({
        forecast_date_utc: date,
        planet_positions: forecast.planet_positions,
        primary_planet: forecast.primary_planet,
        primary_chakra_number: forecast.primary_chakra_number,
        primary_tone: forecast.primary_tone,
        top_petals: forecast.top_petals,
        slogan: llmResult.slogan,
        short_text: llmResult.short_text,
        long_explanation: llmResult.long_explanation,
        math_level: mathLevel,
        generated_at: new Date().toISOString(),
        llm_tokens_used: llmResult._tokens_used,
        llm_model: prompt.model_hint,
        expires_at_utc: calcExpiresAt(date),
      });
      
      results.push({ date, status: "generated" });
    } catch (e) {
      results.push({ date, status: "error", error: String(e) });
    }
  }
  
  // Чистка старых записей
  await supabase
    .from("global_daily_content")
    .delete()
    .lt("expires_at_utc", new Date().toISOString());
  
  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" }
  });
});

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function calcExpiresAt(forecastDateUtc: string): string {
  const d = new Date(forecastDateUtc + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}
```

### 2.1. Расписание cron

В Supabase Dashboard:
- Schedule: `0 0 * * *` (каждый день в 00:00 UTC).
- Headers: `Authorization: Bearer <CRON_SECRET>`.

---

## 3. Глобальный прогноз (без натальной карты)

```typescript
// supabase/functions/_shared/globalDailyForecast.ts

import { computeAspectsBetweenPlanets, computePlanetPositions } from "./astronomy.ts";

export async function computeGlobalDailyForecast(forecastDate: string) {
  // 1. Положения планет на 12:00 UTC выбранной даты
  const positionsAt = new Date(forecastDate + "T12:00:00Z");
  const positions = await computePlanetPositions(positionsAt);
  // { Sun: { lon: 180.5, sign: "Libra", ... }, Moon: {...}, ... }
  
  // 2. Аспекты между планетами (соединения, оппозиции, квадраты, трины, секстили)
  const aspects = computeAspectsBetweenPlanets(positions);
  // [{ from: "Saturn", to: "Sun", type: "trine", orb: 1.2, exact_at: "2026-04-29T08:30:00Z" }, ...]
  
  // 3. "Тяжесть" каждой планеты на день — суммарный вес её аспектов
  const planetGravity: Record<string, number> = {};
  const TRANSIT_WEIGHT: Record<string, number> = {
    Saturn: 1.0, Jupiter: 0.9, Mars: 0.7, Sun: 0.6, 
    Mercury: 0.5, Venus: 0.5, Moon: 0.3
  };
  const ASPECT_COEF: Record<string, number> = {
    conjunction: 1.0, opposition: 0.9, square: 0.8, trine: 0.7, sextile: 0.5
  };
  
  for (const planet of Object.keys(positions)) {
    let gravity = 0;
    for (const asp of aspects) {
      if (asp.from === planet || asp.to === planet) {
        const coef = ASPECT_COEF[asp.type] ?? 0.5;
        const weightFrom = TRANSIT_WEIGHT[asp.from] ?? 0.5;
        const weightTo = TRANSIT_WEIGHT[asp.to] ?? 0.5;
        const orbFactor = 1 - asp.orb / 8;  // 8° = max orb
        gravity += coef * (weightFrom + weightTo) / 2 * orbFactor;
      }
    }
    planetGravity[planet] = gravity;
  }
  
  // 4. Топ-3 планеты по тяжести
  const sorted = Object.entries(planetGravity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);
  
  const PLANET_TO_CHAKRA: Record<string, { number: number; label: string }> = {
    Moon: { number: 1, label: "муладхара" },
    Venus: { number: 2, label: "свадхистхана" },
    Mars: { number: 3, label: "манипура" },
    Jupiter: { number: 4, label: "анахата" },
    Saturn: { number: 5, label: "вишуддха" },
    Mercury: { number: 6, label: "аджна" },
    Sun: { number: 7, label: "сахасрара" },
  };
  
  // 5. Тон каждой топ-планеты — определяется по знаку преобладающих аспектов
  function getToneForPlanet(planet: string): "harmonic" | "dissonant" | "ambivalent_strong" {
    const planetAspects = aspects.filter(a => a.from === planet || a.to === planet);
    let harmonicWeight = 0;
    let dissonantWeight = 0;
    
    for (const asp of planetAspects) {
      const coef = ASPECT_COEF[asp.type] ?? 0;
      if (asp.type === "trine" || asp.type === "sextile") harmonicWeight += coef;
      else if (asp.type === "square" || asp.type === "opposition") dissonantWeight += coef;
      else /* conjunction */ harmonicWeight += coef * 0.5;  // нейтрально-харм.
    }
    
    if (harmonicWeight + dissonantWeight === 0) return "ambivalent_strong";
    const ratio = harmonicWeight / (harmonicWeight + dissonantWeight);
    if (ratio > 0.65) return "harmonic";
    if (ratio < 0.35) return "dissonant";
    return "ambivalent_strong";
  }
  
  const top_petals = sorted.map(([planet, gravity]) => ({
    planet,
    chakra_number: PLANET_TO_CHAKRA[planet].number,
    chakra_label: PLANET_TO_CHAKRA[planet].label,
    gravity,
    tone: getToneForPlanet(planet),
    main_aspects: aspects
      .filter(a => a.from === planet || a.to === planet)
      .sort((a, b) => (ASPECT_COEF[b.type] ?? 0) - (ASPECT_COEF[a.type] ?? 0))
      .slice(0, 2),
  }));
  
  return {
    forecast_date: forecastDate,
    planet_positions: positions,
    aspects,
    primary_planet: top_petals[0].planet,
    primary_chakra_number: top_petals[0].chakra_number,
    primary_tone: top_petals[0].tone,
    top_petals,
  };
}
```

---

## 4. Промпт global_morning_recommendation

Аналогичен `monologue_morning_recommendation` из PATCH 13, но **без натальной карты пользователя**. Опирается только на текущие транзиты.

```sql
INSERT INTO public.prompts (
  prompt_key, prompt_type, use_case, version, is_active,
  template, variables, model_hint, temperature, max_output_tokens, response_format
) VALUES (
  'global_morning_recommendation', 'recommendation', NULL, 1, true,
  $TEMPLATE$
ЗАДАЧА: Сгенерируй три текста — slogan, short_text (~500 знаков), long_explanation 
(~1500 знаков) — для общего астропсихологического дайджеста дня. Этот текст 
показывается ВСЕМ пользователям с бесплатным тарифом, поэтому НЕ должен 
персонализироваться: только общая картина дня по положениям планет.

КАРТИНА ДНЯ (топ-3 планеты по активности):
{{top_petals_json}}

Аспекты дня (для упоминания в long_explanation):
{{aspects_json}}

ПРИНЦИПЫ:

1. РЕКОМЕНДАТЕЛЬНЫЙ ТОН (не декларативный):
   ✅ "Сегодня естественно открывается тема [состояний]"
   ❌ "Сегодня будет включена пятая чакра"

2. SHORT_TEXT — литературный микро-текст ~500 знаков, четыре части:
   - Часть 1 (вход): общее настроение дня языком состояний, без упоминания чакр.
   - Часть 2 (разворот): парадоксальный поворот — внутреннее измерение темы.
   - Часть 3 (язык состояний): 3-5 конкретных состояний главной чакры.
   - Часть 4 (мостик): только В ФИНАЛЕ — указание на чакру для практики.

3. SLOGAN — короткая цепляющая фраза ~50 знаков, импульс к развитию.

4. LONG_EXPLANATION — астропсихологический разбор:
   - Общая картина (какие планеты сегодня активны).
   - Главная тема (чем характерна).
   - Второй и третий лепестки (как они вплетаются).
   - Концептуальные опоры (1 ссылка на классиков: Лилли / Птолемей / Порфирий).
   - Заключение с приглашением к практике.

ЗАПРЕЩЕНО:
- Персонализированные обращения вида "у тебя сегодня".
- Упоминание натальной карты пользователя ("ваш Сатурн в...").
- Обращение «ты» — в общих рекомендациях нейтральное безличное / «вы».

Используй обращение «вы» как нейтральную форму уважительного безличного.

ФОРМАТ ОТВЕТА: строгий JSON:
{
  "slogan": "...",
  "short_text": "...",
  "long_explanation": "..."
}
$TEMPLATE$,
  '{
    "top_petals_json": {"type": "string", "required": true},
    "aspects_json": {"type": "string", "required": true}
  }'::jsonb,
  'gemini-2.5-flash', 0.85, 2200, 'json_object'
);
```

---

## 5. Endpoint /api/ai/global-content

```typescript
// _legacy_web/app/api/ai/global-content/route.ts

import { NextRequest, NextResponse } from "next/server";
import { validateJwt } from "@/app/api/_utils/auth";
import { createServiceSupabase } from "@/app/api/_utils/supabase";

/**
 * Возвращает global_daily_content на текущую локальную дату пользователя.
 * Используется бесплатными пользователями.
 */
export async function POST(req: NextRequest) {
  const userId = await validateJwt(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const supabase = createServiceSupabase();
  
  // Получаем tz пользователя
  const { data: user } = await supabase
    .from("users")
    .select("tz, tier")
    .eq("id", userId)
    .single();
  
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  
  // Считаем локальную дату пользователя
  const localDate = todayLocalDate(user.tz ?? "UTC");
  
  // Получаем контент. Локальная дата может быть UTC-1, UTC или UTC+1 относительно настоящего UTC.
  const { data: content, error } = await supabase
    .from("global_daily_content")
    .select("*")
    .eq("forecast_date_utc", localDate)
    .maybeSingle();
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  if (!content) {
    // Контента нет (маловероятно если cron работает). Берём ближайший.
    const { data: fallback } = await supabase
      .from("global_daily_content")
      .select("*")
      .order("forecast_date_utc", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (fallback) {
      return NextResponse.json({
        ...fallback,
        is_fallback: true,
        fallback_date: fallback.forecast_date_utc,
      });
    }
    return NextResponse.json({ error: "No global content available" }, { status: 503 });
  }
  
  return NextResponse.json({
    slogan: content.slogan,
    short_text: content.short_text,
    long_explanation: content.long_explanation,
    math_level: content.math_level,
    primary_planet: content.primary_planet,
    primary_chakra_number: content.primary_chakra_number,
    primary_tone: content.primary_tone,
    top_petals: content.top_petals,
    forecast_date: content.forecast_date_utc,
    is_global: true,
    user_tier: user.tier,
  });
}

function todayLocalDate(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return formatter.format(new Date());
}
```

---

## 6. Frontend: переключение источника по tier

```typescript
// modules/home-screen/useDayContent.ts

import { useUser } from "./useUser";
import { useDailyForecast } from "./useDailyForecast";
import { callMonologue } from "@/services/aiClient";
import { fetchGlobalContent } from "@/services/globalContentClient";

export function useDayContent() {
  const user = useUser();
  const forecast = useDailyForecast();  // только для платных
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (!user) return;
    
    setLoading(true);
    
    if (user.tier === "free") {
      // Бесплатный: общий контент с бэкенда
      fetchGlobalContent().then(c => {
        setContent({ ...c, is_global: true });
        setLoading(false);
      });
    } else {
      // Платный/trial: индивидуальный контент по натальной карте
      if (!forecast) return;
      
      callMonologue("morning_recommendation", buildVariables(user, forecast)).then(c => {
        setContent({ ...c, is_global: false });
        setLoading(false);
      });
    }
  }, [user?.tier, forecast?.forecast_date]);
  
  return { content, loading };
}
```

UI на главной странице может показывать маленький индикатор «Общая картина дня» / «Персональная карта» — пользователю полезно понимать разницу. Но это опционально (UI-задача отдельной итерации).

---

## 7. Окна возможностей на клиенте (для бесплатного тарифа)

Для бесплатного тарифа окна возможностей считаются не индивидуально (нет натальной карты), а общие — по транзитной планете дня:
- Восход planet_of_the_day в локальной точке пользователя.
- Кульминация planet_of_the_day.
- Точный аспект (если он есть в этот день и попадает в локальный интервал) — берётся из `top_petals[0].main_aspects[0]`.

Все три рассчитываются на клиенте через JS-эфемериды, потому что они зависят от **локации пользователя**, а не от его натальной карты. Это не нагружает бэкенд.

```typescript
// modules/daily-engine/computeWindowsForFreeUser.ts

export function computeWindowsForFreeUser(
  primaryPlanet: string,
  topAspect: { from: string; to: string; type: string; exact_at: string } | null,
  userLocation: { lat: number; lon: number },
  forecastDate: string,
  tz: string,
) {
  // Все вычисления на клиенте через swisseph-wasm или astronomia
  return {
    sunrise: computePlanetRise(primaryPlanet, userLocation, forecastDate, tz),
    culmination: computePlanetCulmination(primaryPlanet, userLocation, forecastDate, tz),
    exactAspect: topAspect ? convertToLocalTime(topAspect.exact_at, tz) : null,
  };
}
```

---

## 8. Trial logic

При регистрации `tier = "trial"`, `trial_expires_at = now + 3 days`. Cron-функция (или middleware при заходе) проверяет: если `trial_expires_at < now` и `tier = trial` → переводит в `tier = free`.

Можно добавить в существующую cron-функцию:

```typescript
// в начале любой ежедневной cron-функции
await supabase
  .from("users")
  .update({ tier: "free" })
  .eq("tier", "trial")
  .lt("trial_expires_at", new Date().toISOString());
```

---

## 9. Тесты

```typescript
describe("computeGlobalDailyForecast", () => {
  it("returns top 3 planets sorted by gravity", async () => {
    const forecast = await computeGlobalDailyForecast("2026-04-29");
    expect(forecast.top_petals).toHaveLength(3);
    expect(forecast.top_petals[0].gravity).toBeGreaterThanOrEqual(forecast.top_petals[1].gravity);
  });
  
  it("primary_tone is one of valid values", async () => {
    const forecast = await computeGlobalDailyForecast("2026-04-29");
    expect(["harmonic", "dissonant", "ambivalent_strong"]).toContain(forecast.primary_tone);
  });
});

describe("/api/ai/global-content", () => {
  it("returns content for free user", async () => {
    // ...
  });
  
  it("falls back to most recent if exact date missing", async () => {
    // ...
  });
});
```

---

## 10. Инструкции для Cursor

### Право на адаптацию

1. Если в кодовой базе уже есть похожие cron-функции (`precompute-daily-forecasts`) — посмотреть, не дублируется ли работа. Возможно, имеет смысл их объединить или переиспользовать общий код.
2. Если структура `users.tier` уже есть с другим именем (например, `subscription_status`) — использовать существующее.
3. Если Cursor видит, что эфемериды на бэкенде отсутствуют (только клиент) — реализовать через тот же алгоритм что и в `modules/astro-core`, но Deno-совместимым кодом. Можно скопировать код `computePlanetPositions` из астро-модуля в `_shared/astronomy.ts`.

### Порядок применения

1. Миграция `add_user_tier.sql` + миграция `global_daily_content`.
2. Промпт `global_morning_recommendation` в БД.
3. Реализация `computeGlobalDailyForecast` (Deno, в `_shared/`).
4. Реализация cron-функции `precompute-global-recommendations`.
5. Endpoint `/api/ai/global-content`.
6. Frontend hook `useDayContent` с разветвлением по tier.
7. Логика trial → free (в любой ежедневной cron).

### Порядок тестирования

1. В админке вручную выставить `tier = free` для тестового пользователя.
2. Запустить cron-функцию вручную через `curl -X POST /functions/v1/precompute-global-recommendations -H "Authorization: Bearer $CRON_SECRET"`.
3. Открыть приложение под этим пользователем — должен загрузиться общий контент.
4. Проверить, что у trial-пользователя через 3 дня `tier` стал `free`.

---

## 11. Критерий приёмки

- ✅ Поле `users.tier` существует с тремя значениями.
- ✅ Таблица `global_daily_content` создана.
- ✅ Cron-функция `precompute-global-recommendations` готовит контент на ближайшие 2 UTC-дня.
- ✅ Промпт `global_morning_recommendation` активен в БД.
- ✅ Endpoint `/api/ai/global-content` возвращает контент по локальной дате пользователя.
- ✅ Frontend разветвляет источник данных по `user.tier`.
- ✅ Старый контент удаляется через `expires_at_utc`.
- ✅ Trial-пользователи автоматически переходят в free через 3 дня.
- ✅ Все unit-тесты проходят.
