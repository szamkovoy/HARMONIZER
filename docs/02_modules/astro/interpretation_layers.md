---
id: 02_modules/astro/interpretation_layers
title: Astro Interpretation Layers
version: 1.4
updated: 2026-06-26
depends_on: [01_foundation/architecture, 02_modules/daily_forecast/spec]
code_refs:
  [
    modules/daily-engine/core/types.ts,
    _legacy_web/app/api/_utils/morningRecommendation.ts,
    _legacy_web/app/api/_utils/mathLevelBuilder.ts,
    _legacy_web/app/api/ai/monologue/route.ts,
    modules/home/ui/DailyRecommendationCard.tsx,
    modules/home/ui/ModalLongExplanation.tsx,
    modules/home/ui/ModalMathLevel.tsx,
    modules/home/i18n/home.ts,
    modules/home/useDayContent.ts,
    services/globalContentClient.ts,
    supabase/migrations/20260501193000_free_tier_global_content.sql,
  ]
---

В продукте четыре уровня текстовой/числовой «интерпретации» дня завязаны на тип `DailyForecast` (`modules/daily-engine/core/types.ts`) и на сценарий **`morning_recommendation`** (Gemini JSON через `_legacy_web/app/api/ai/monologue/route.ts` и общую утилиту `_legacy_web/app/api/_utils/morningRecommendation.ts`). Имена полей ниже — **как в коде** (camelCase в TS / snake_case в БД для части колонок).

## 1. Слоган — `slogan`

- **Смысл:** короткая формулировка дня для шапки главного экрана.
- **Источник:** LLM по промпту сценария `morning_recommendation` (поле в JSON ответа; плейсхолдеры целевой длины — `CONTENT_LENGTHS.SLOGAN_TARGET_CHARS` в переменных промпта).
- **Данные в промпт:** топ-планеты «лепестки» (`buildTopPetals`), натал, калибровка, baseline чакр, лексикон пользователя и др. из `morningRecommendation.ts` / `buildMorningRecommendationVariables` в `monologue/route.ts`.
- **UI:** `modules/home/i18n/home.ts` — функции `daySlogan` читают `forecast.slogan`; при отсутствии — запасные строки.

## 2. Краткая рекомендация — `recommendationShortText` (в БД `recommendation_short_text`)

- **Смысл:** основной абзац в карточке рекомендации на главной (~целевой размер из `CONTENT_LENGTHS.SHORT_TEXT_TARGET_CHARS`).
- **Источник:** тот же LLM JSON (`short_text`).
- **UI:** `getForecastRecommendation` в `modules/home/i18n/home.ts` → `DailyRecommendationCard` показывает этот текст через `sanitizeRecommendationDisplay`; если пусто — `strings.recommendation.fallback(forecast)`.

## 3. Подробное объяснение — `recommendationLongText` (`recommendation_long_text`)

- **Смысл:** развёрнутый текст для модалки «Подробнее».
- **Источник:** LLM (`long_explanation` в JSON). В промптах `global_morning_recommendation` v4+ и `monologue_morning_recommendation` v5+ chakra-лексика — только номерная форма; v5 additionally bans English tone keys in visible JSON and shortens §6 to «ЗАКЛЮЧЕНИЕ».
- **UI:** `ModalLongExplanation` из `DailyRecommendationCard.tsx`; LLM-текст проходит `sanitizeRecommendationDisplay`; если поля нет, подставляется собранный из шаблонов продуктовый `detailText` на клиенте.

## 4. Математический слой — `mathLevel` (`math_level`)

- **Смысл:** не LLM-текст «с нуля», а **детерминированная** сборка: markdown + структура для UI и карты.
- **Источник:** `buildMathLevel` в `_legacy_web/app/api/_utils/mathLevelBuilder.ts` (активация, importance, аспекты, `S`/`H` с натала и дельты калибровки). В ответ monologue поле добавляется сервером рядом с JSON модели (`math_level` в payload).
- **Формат (personal):** `{ markdown: string; structured?: { natal_strengths, main_aspects, importance_breakdown, calibration_deltas? } }` — см. интерфейс `MathLevelData` в `mathLevelBuilder.ts`.
- **Формат (free/global):** `buildGlobalMathLevel` собирает transit-only payload с `structured.schema_version = 2`, `chart_mode = "transit_only"`, `planet_positions`, `planet_scores`, `top_petals`, `aspects`, `main_aspects`. Этот слой не использует натал и поэтому открывает только общий транзитный круг дня.
- **UI:** `ModalLongExplanation` оркестрирует цепочку `long` → `math` → `chart` через `HomeExplainerLevel`; `ModalMathLevel` — рендер `mathLevel.markdown` через `MarkdownText`; math/chart — **`SlideUpModalLayer`** поверх статичного long-слоя (`presentation="stackLayer"`, не sibling RN `Modal`); aspects для chart — **`chartAspectsFromMathLevel`** из `structured.main_aspects`. Из того же payload открывается либо personal natal+transit chart, либо free transit-only chart. Планеты, знаки, аспекты, `orb`/`tone`/`gravity` в markdown локализуются по активной locale, а free fallback через прямое чтение `global_daily_content` пересобирает этот markdown из structured payload, чтобы не показывать сырой RU/EN текст.

## 5. Обогащение на клиенте

- **`modules/home/useDayContent.ts` — `enrichWithMorningContent`:** после получения прогноза вызывается `callMonologue("morning_recommendation", …)` и поля `slogan`, `recommendationShortText`, `recommendationLongText`, `mathLevel` дописываются в объект `DailyForecast` в памяти.

## 6. Бесплатный тариф (глобальный контент)

- Те же четыре слоя существуют в таблице `global_daily_content` (колонки `slogan`, `short_text`, `long_explanation`, `math_level`) — см. миграцию `supabase/migrations/20260501193000_free_tier_global_content.sql` и клиент `services/globalContentClient.ts`, который мапит ответ в поля `DailyForecast`.
- Global LLM-тексты строятся отдельным prompt `global_morning_recommendation`: он остаётся неперсональным и без натала, но теперь рассчитан на ту же глубину short/long explanation, что и paid-home, а formulas/chart слой расширен до полноценного transit-only разбора.

## 7. Связь с астрологическим движком

- Числовой слой прогноза (`importance`, `activation`, `planetOfTheDay`, `windowsOfOpportunity`, …) считается в `daily-engine` до вызова LLM; тексты и `mathLevel` **опираются** на уже посчитанный `DailyForecast` и натал.
