---
id: 02_modules/astro/interpretation_layers
title: Astro Interpretation Layers
version: 1.1
updated: 2026-05-07
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
- **UI:** `getForecastRecommendation` в `modules/home/i18n/home.ts` → `DailyRecommendationCard` показывает этот текст; если пусто — `strings.recommendation.fallback(forecast)`.

## 3. Подробное объяснение — `recommendationLongText` (`recommendation_long_text`)

- **Смысл:** развёрнутый текст для модалки «Подробнее».
- **Источник:** LLM (`long_explanation` в JSON).
- **UI:** `ModalLongExplanation` из `DailyRecommendationCard.tsx`; если поля нет, подставляется собранный из шаблонов продуктовый `detailText` на клиенте.

## 4. Математический слой — `mathLevel` (`math_level`)

- **Смысл:** не LLM-текст «с нуля», а **детерминированная** сборка: markdown + структура для UI и натальной карты.
- **Источник:** `buildMathLevel` в `_legacy_web/app/api/_utils/mathLevelBuilder.ts` (активация, importance, аспекты, `S`/`H` с натала и дельты калибровки). В ответ monologue поле добавляется сервером рядом с JSON модели (`math_level` в payload).
- **Формат:** `{ markdown: string; structured?: { natal_strengths, main_aspects, importance_breakdown, calibration_deltas? } }` — см. интерфейс `MathLevelData` в `mathLevelBuilder.ts`.
- **UI:** `ModalMathLevel` — рендер `mathLevel.markdown` через `MarkdownText`, опционально диаграмма аспектов из `structured.main_aspects`; кнопка «Подробнее» открывает матслой только если `forecast.mathLevel?.markdown` непустой.

## 5. Обогащение на клиенте

- **`modules/home/useDayContent.ts` — `enrichWithMorningContent`:** после получения прогноза вызывается `callMonologue("morning_recommendation", …)` и поля `slogan`, `recommendationShortText`, `recommendationLongText`, `mathLevel` дописываются в объект `DailyForecast` в памяти.

## 6. Бесплатный тариф (глобальный контент)

- Те же четыре слоя существуют в таблице `global_daily_content` (колонки `slogan`, `short_text`, `long_explanation`, `math_level`) — см. миграцию `supabase/migrations/20260501193000_free_tier_global_content.sql` и клиент `services/globalContentClient.ts`, который мапит ответ в поля `DailyForecast`.

## 7. Связь с астрологическим движком

- Числовой слой прогноза (`importance`, `activation`, `planetOfTheDay`, `windowsOfOpportunity`, …) считается в `daily-engine` до вызова LLM; тексты и `mathLevel` **опираются** на уже посчитанный `DailyForecast` и натал.
