---
id: 02_modules/daily_forecast/dependencies
title: Daily_forecast Dependencies
version: 2.1
updated: 2026-06-10
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/subscription/spec, 02_modules/astro/caching_strategy]
code_refs:
  [
    app/(tabs)/index.tsx,
    modules/home/useDayContent.ts,
    services/dailyForecastClient.ts,
    services/dayContentCache.ts,
    services/homeDayContentReloadRequest.ts,
    services/globalContentClient.ts,
    modules/daily-engine/index.ts,
    modules/daily-engine/planetDiurnalCurve.ts,
    modules/daily-engine/freeWindows.ts,
    modules/home/ui/OpportunityWindows.tsx,
    modules/home/i18n/home.ts,
    modules/home/ui/DailyRecommendationCard.tsx,
    modules/chakra/labels.ts,
    _legacy_web/app/api/astro/daily-forecast/route.ts,
    supabase/functions/daily-forecast/index.ts,
  ]
---

## 1. Зависит от

- **`chakra` (русские подписи чакр)**
  - `modules/home/i18n/home.ts` — `chakraLabelGenitiveRu` в fallback-рекомендации дня (RU) и EN-формулировке «qualities of Chakra N».
  - `modules/home/ui/DailyRecommendationCard.tsx` — `chakraLabelGenitiveRu` в клиентском `detailText`, когда серверный long-text отсутствует.
  - `modules/home/planetChakra.ts` + `data/planet_chakra_map.json` дают `chakraNumber`/`label`/`color` для баннера; `chakraName` строится через `chakraLabelRu(chakra_number)`, не из поля `chakra_name_ru` JSON.

- **`astro` (типы и движок)**  
  - `modules/daily-engine` импортирует `NatalProfile` и эфемериды из `modules/astro-core`; активация/важность опираются на JSON планет натала.  
  - Серверные маршруты прогноза используют `loadActiveNatalProfile` / те же структуры, что и модуль `astro`.
  - **Клиентский UI home → daily-engine:** `OpportunityWindows.tsx` — `samplePlanetAltitudeForDay`, `interpolateDiurnalAltitude`, `dayFractionFromIso`; `freeWindows.ts` и `ephemeris.ts` (`AstronomiaTransitProvider`) — `computeDiurnalWindowTimes` (общая суточная дискретизация с графиком). Суточная кривая и штрих «сейчас» — `react-native-svg` (`Svg`, `Polyline`, `Line`).

- **`calibration` (данные на сервере, не импорт модуля на клиенте)**  
  - `_legacy_web/app/api/astro/daily-forecast/route.ts` и Edge `daily-forecast` читают активную строку `user_calibrations` и передают `CalibrationLike | null` в движок; `effectiveNatalParams` при `null` оставляет `S_initial`/`H_initial`.  
  - Инвалидация кэша прогноза после extract калибровки — парная запись в `docs/02_modules/calibration/dependencies.md` §2.

- **`profile`**  
  - `useDayContent` через `useAuth()` берёт `tz`, `lat`/`lon`, birth-поля, tier/trial для `scopeKey`, режима доступа и автодозапроса геолокации (`acquireAndPersistUserCoordinates`). Для paid-home именно `users.birth_date` решает, можно ли запускать персональный прогноз; отдельный клиентский fetch `user_natal_charts` больше не считается обязательным блокером первого рендера.  
  - `recentPlanetsOfDay` читается сервером из `user_settings.preferences` (см. `loadRecentPlanets` в `daily-forecast/route.ts`).  
  - После смены натала с **`app/(tabs)/profile.tsx`** главный экран может запросить **`refresh` с `blockingReload`** через **`consumeHomeDayContentBlockingReload`** (`services/homeDayContentReloadRequest.ts`) при фокусе таба Home.

- **`subscription`**  
  - `app/(tabs)/index.tsx` — `useAccess().canUseFeature("personal_daily_forecast")` и проброс tier в `useDayContent`; внутри хука ветка `nextAccessMode === "free"` vs персональный прогноз и разные базовые URL.

- **`infra`**  
  - Supabase auth для JWT в клиентских fetch, таблицы `user_daily_forecasts`, `user_settings`, Edge/Vercel runtime.

## 2. От него зависят

- **`assistant` (сервер)**  
  - `_legacy_web/app/api/communicator/v2/dialog/route.ts`, `v2/greeting/route.ts`, `v2/recommendation-text/route.ts`, `v2/correct-recommendation/route.ts` читают `user_daily_forecasts` (планета дня, тексты, важность, окна) для контекста ответов. Начиная с HARMONIZER v2 daily dialog также пишет обратно `day_target_chakra`, `day_target_reason`, `day_target_fixed_at`.
  - UI-модуль `communicator` напрямую типы прогноза **не** импортирует; связь идёт через сервер и общий UX главного экрана.

- **`practices`**  
  - `app/(tabs)/index.tsx` вызывает `launchPractice` с контекстом, производным от дня (чакра/практика с главного экрана); карта планета→чакра — `modules/home/planetChakra.ts`, питается `forecast.planetOfTheDay`.

## 3. Контрактные точки риска

- **Симметрия полей `DailyForecast` и snake_case в БД** — любое переименование ломает `normalizeForecast` и SQL mapping (`dailyForecastToInsert`).
- **Новый серверный контракт `day_target_*`** — home и assistant уже начинают жить на этих полях; их удаление/переименование без синхронной правки dialog-route даст тихий разрыв между прогнозом дня и daily dialog.
- **`cacheValidUntil` vs клиентский `expiresAt` в `dayContentCache`** — оба должны оставаться согласованы с локальным концом дня; расхождение Node/Edge см. open questions.
- **Пустой `recentPlanetsOfDay` на мобильном пути** — смена поведения `chooseFinalPlanet` неочевидна для QA без заполненных preferences.
- **Дубли формул Node/Deno** — правки только в одной копии дадут расхождение; опора на `daily-engine-parity.test.ts` + ручная осторожность вне покрытия теста.
- **`forceRefresh` и кэш SecureStore** — должны инвалидироваться согласованно (`clearDayContentCache` в хуке).
