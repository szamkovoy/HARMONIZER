---
id: 02_modules/daily_forecast/spec
title: Daily_forecast Spec
version: 1.3
updated: 2026-05-09
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/subscription/spec, 02_modules/astro/caching_strategy]
code_refs:
  [
    app/(tabs)/index.tsx,
    modules/home/useDayContent.ts,
    modules/home/ui/ChakraFlower.tsx,
    services/dailyForecastClient.ts,
    services/dayContentCache.ts,
    services/globalContentClient.ts,
    modules/daily-engine/index.ts,
    modules/daily-engine/computeDailyForecast.ts,
    _legacy_web/app/api/astro/daily-forecast/route.ts,
    supabase/functions/daily-forecast/index.ts,
    supabase/functions/precompute-daily-forecasts/index.ts,
  ]
---

## 1. Назначение

Модуль описывает **продуктовый контур дневного прогноза на главном экране**: загрузка и кэширование данных дня, ветвление free vs персональный прогноз, обогащение текстами и связь UI (важность, планета дня, окна, чакра) с остальным приложением. Числовой движок активации, важности и окон живёт в пакете `modules/daily-engine` и на сервере (Next.js и Edge); этот spec фиксирует **контракт потока данных и интеграций**, а не пересказ формул.

## 2. Публичный контракт

### Клиентские типы (реэкспорт из `modules/daily-engine`)

- `DailyEngineInput` — вход движка: `natalProfile`, `calibration | null`, `forecastDate`, `userLocation`, `recentPlanetsOfDay`.
- `DailyForecast` — результат: `date`, `importance`, `activation`, `rankedPlanets`, `planetOfTheDay`, `isAlternativeChoice`, `alternativeReasonText?`, `todayPlanetState`, `windowsOfOpportunity`, `transitChart`, `computedAt`, `cacheValidUntil`, опционально `recommendationShortText`, `recommendationLongText`, `slogan`, `mathLevel`, `isGlobal?`.
- Вспомогательные типы: `Planet`, `TodayTone`, `CalibrationLike`, `TransitChart`, и др. из `modules/daily-engine/core/types.ts`.

### Хук и состояние главного экрана

- `useDayContent(options?)` → `UseDayContentResult` (`modules/home/useDayContent.ts`):
  - `forecast: DailyForecast | null`, `accessMode`, `modelUsed`, `source` (`"cache" | "computed" | "global"`), `status`, `loading`, `error`, `refresh(opts?)`.
  - Локальный календарный день: `Intl` + `forecastDate` в IANA-зоне из профиля/геолокации.
  - Free: `fetchGlobalContent` + URL из `getAiGlobalContentUrl()`; premium/trial: `fetchDailyForecast` + `getDailyForecastUrl()` (Vercel `/api/astro/daily-forecast` или Supabase Function — определяется `communicatorConfig`).
  - Неполный ответ персонального режима: дообогащение через `callMonologue("morning_recommendation", …)` (`services/aiClient.ts`).
  - **`DailyRecommendationCard`**: строка отладки `model: … · accessMode` под рекомендацией показывается только при **`__DEV__`** (не в production).

### Сервисы транспорта и кэша

- `fetchDailyForecast(req: DailyForecastRequest): Promise<DailyForecastResult>` (`services/dailyForecastClient.ts`) — POST с JWT; тело: `forecastDate?`, `userLocation`, `recentPlanetsOfDay?`, `forceRefresh?`; нормализация snake_case ↔ camelCase.
- `fetchGlobalContent` (`services/globalContentClient.ts`) — собирает `DailyForecast`-совместимый объект для free-режима (в т.ч. `computeWindowsForFreeUser` из `daily-engine`).
- `loadDayContentCache` / `saveDayContentCache` / `peekDayContentCache` / `pruneDayContentCache` / `clearDayContentCache` (`services/dayContentCache.ts`) — локальный кэш дня (SecureStore / web storage + manifest), ключ: user + `accessMode` + `accessTier` + `forecastDate` + `scopeKey` + координаты.

### Серверные эндпоинты (персональный прогноз)

- `POST _legacy_web/app/api/astro/daily-forecast/route.ts` — Node: кэш `user_daily_forecasts`, загрузка натала, активной калибровки, `recentPlanetsOfDay`, расчёт через `computeDailyForecastWithAstronomia`, upsert строки прогноза, `ensureMorningRecommendation`.
- `POST supabase/functions/daily-forecast/index.ts` — Edge-аналог (общий расчётный слой в `supabase/functions/_shared/dailyForecast.ts`).
- Фоновый контур: `supabase/functions/precompute-daily-forecasts/index.ts` — предрасчёт для пользователей с сохранёнными координатами.

## 3. Внутренняя архитектура

1. **Движок (чистая математика + адаптер эфемерид):** `modules/daily-engine` — `computeDailyForecast` / `computeDailyForecastFromTransits`, активация и важность через `effectiveNatalParams` (при `calibration == null` используются только `S_initial` / `H_initial` из натала), ранжирование и `chooseFinalPlanet`, опционально окна через `TransitProvider.computeWindowsOfOpportunity`. `cacheValidUntil` в основном пути: конец локального календарного дня прогноза (`endOfForecastDateUtc` в `computeDailyForecast.ts`).
2. **Сервер:** загрузка `NatalProfile`, `CalibrationLike | null` из `user_calibrations`, чтение `recentPlanetsOfDay` из `user_settings.preferences`, запись/чтение `user_daily_forecasts`. Инвалидация строк прогноза при успешной калибровке — см. `docs/02_modules/calibration/dependencies.md` и `docs/02_modules/astro/caching_strategy.md`.
3. **Клиент:** `useDayContent` orchestrates профиль → геолокация → кэш → HTTP; главный экран (`app/(tabs)/index.tsx`) рендерит карточки и `ChakraFlower`, маппинг планета → чакра — `modules/home/planetChakra.ts` + `data/planet_chakra_map.json`.

Стратегия серверного и клиентского кэша, таблицы и TTL описаны **краткой ссылкой** в `docs/02_modules/astro/caching_strategy.md` (без дублирования содержимого здесь).

## 4. Конфигурация и параметры

- **Режим доступа:** `subscription` / `useAccess` на главном экране задаёт, нужен ли натал и какой URL/пайплайн вызывать; `useDayContent` дублирует правило trial через `accessModeFor` / `hasPremiumAccess` (см. open questions по консолидации правил).
- **`scopeKey` дня:** отпечаток birth-полей для ключа кэша персонального режима; для free — литерал `"global"`.
- **`recentPlanetsOfDay`:** до двух планет `[день−1, день−2]` в `user_settings.preferences`; сервер подставляет из БД, если клиент не передал массив в теле запроса. Текущий клиентский путь `useDayContent` → `fetchDailyForecast` **не передаёт** `recentPlanetsOfDay`, поэтому на практике используется только то, что уже лежит в `preferences` (если пусто — в движок уходит пустой список и альтернативная логика `chooseFinalPlanet` не активируется по «недавности»).
- **`precisionMode` натала:** влияет на демпфирование лунных вкладов в активации (`approximate` / `unknown`) — детали в reference, не здесь.
- **Таймаут HTTP:** `DAILY_FORECAST_TIMEOUT_MS` в `dailyForecastClient.ts`.

## 5. Известные ограничения

- **Edge fallback и `cacheValidUntil`:** в Edge-функции для части fallback-ответов TTL может задаваться как `now + 24h`, что расходится с timezone-aware правилом Node-движка; зафиксировано в `docs/04_workspace/open_questions.md` и в `caching_strategy.md` — в продуктовом spec не дублировать детали, только признать класс риска.
- **Дублирование реализации M2:** формулы поддерживаются в Node (`modules/daily-engine`) и в Deno (`supabase/functions/_shared/dailyForecast.ts`); есть **частичный** parity-тест (см. ниже и open questions).
- **Parity-тест:** `supabase/functions/_shared/daily-engine-parity.test.ts` сравнивает Node и Deno для `effectiveNatalParams`, `computeActivation`, `computeImportance` (включая ветки `precisionMode`); не покрывает целиком `chooseFinalPlanet`, ранжирование после изменений в одной ветке без зеркала, ни полный `computeDailyForecast` с реальными окнами.

## Справочные материалы

Методика расчётов (активация, важность, окна, орбисы, коэффициенты) — только в reference:

- `docs/04_reference/astrology/activation_and_importance.md`
- `docs/04_reference/astrology/windows_of_opportunity.md`
- `docs/04_reference/astrology/essential_dignities.md`
- `docs/04_reference/astrology/accidental_dignities.md`
- `docs/04_reference/astrology/harmoniousness.md`
