---
id: 02_modules/daily_forecast/dependencies
title: Daily_forecast Dependencies
version: 2.15
updated: 2026-06-26
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/subscription/spec, 02_modules/astro/caching_strategy]
code_refs:
  [
    app/(tabs)/index.tsx,
    app/(tabs)/day.tsx,
    modules/home/useDayContent.ts,
    modules/home/stripHomeLlmTexts.ts,
    services/dailyForecastClient.ts,
    services/dayContentCache.ts,
    services/dayPlan.ts,
    services/dayPlanCache.ts,
    services/homeDayContentReloadRequest.ts,
    services/globalContentClient.ts,
    modules/daily-engine/index.ts,
    modules/daily-engine/planetDiurnalCurve.ts,
    modules/daily-engine/freeWindows.ts,
    modules/home/ui/OpportunityWindows.tsx,
    modules/home/i18n/home.ts,
    modules/home/ui/DailyRecommendationCard.tsx,
    modules/home/sanitizeRecommendationDisplay.ts,
    modules/chakra/i18n.ts,
    modules/home/planetChakra.ts,
    _legacy_web/app/api/astro/daily-forecast/route.ts,
    _legacy_web/app/api/_utils/dailyForecastPayload.ts,
    _legacy_web/app/api/_utils/morningRecommendation.ts,
    supabase/functions/daily-forecast/index.ts,
  ]
---

## 1. Зависит от

- **`chakra` (локализованные подписи чакр)**
  - `modules/home/i18n/home.ts`, `DailyRecommendationCard.tsx` — `chakraLabelGenitive(locale, …)` в fallback-рекомендациях.
  - `modules/home/planetChakra.ts` — **`getPlanetChakraMap(locale)`** + JSON (номер/ключ/цвет); `shortLabel`/`chakraName` из `modules/chakra/i18n.ts`.

- **`i18n`**
  - Home/Day UI strings через `getHomeStrings(locale)`; `fetchGlobalContent` / monologue — `responseLocale` из `getResponseLocale()`.
  - **`services/globalContentClient.ts`** direct Supabase fallback imports `_legacy_web/app/api/_utils/recommendationText.ts` (`normalizeRecommendationText`, `isCurrentGlobalLongExplanation`) and `mathLevelI18n.ts` to normalize legacy tone/chakra vocabulary, drop unstructured/chakra-heavy `long_explanation`, and rebuild localized free `math_level.markdown` from structured transit payload when `/api/ai/global-content` times out.
  - **`modules/home/sanitizeRecommendationDisplay.ts`** — client-side display pass over `normalizeRecommendationText` in `useDayContent` and `DailyRecommendationCard`.
  - **`useDayContent`** подписан на **`subscribeAppLocale`**: смена языка сбрасывает locale-specific LLM-поля (`stripHomeLlmTexts`) и запускает фоновый `refresh({ localeChange: true })`; ключ кэша дня включает суффикс `AppLocale`. **`app/(tabs)/profile.tsx`** при смене локали больше не вызывает `markHomeDayContentBlockingReload` — blocking reload остаётся только для смены натала. **`fetchDailyForecast`** передаёт **`responseLocale`** (`getResponseLocale()`).

- **`astro` (типы и движок)**  
  - `modules/daily-engine` импортирует `NatalProfile` и эфемериды из `modules/astro-core`; активация/важность опираются на JSON планет натала.  
  - Серверные маршруты прогноза используют `loadActiveNatalProfile` / те же структуры, что и модуль `astro`.
  - **Клиентский UI home → daily-engine:** `OpportunityWindows.tsx` — `samplePlanetAltitudeForDay`, `interpolateDiurnalAltitude`, `dayFractionFromIso`; `freeWindows.ts` и `ephemeris.ts` (`AstronomiaTransitProvider`) — `computeDiurnalWindowTimes` (общая суточная дискретизация с графиком). Суточная кривая и штрих «сейчас» — `react-native-svg` (`Svg`, `Polyline`, `Line`).

- **`calibration` (данные на сервере, не импорт модуля на клиенте)**  
  - `_legacy_web/app/api/astro/daily-forecast/route.ts` и Edge `daily-forecast` читают активную строку `user_calibrations` и передают `CalibrationLike | null` в движок; `effectiveNatalParams` при `null` оставляет `S_initial`/`H_initial`.  
  - Инвалидация кэша прогноза после extract калибровки — парная запись в `docs/02_modules/calibration/dependencies.md` §2.

- **`profile`**  
  - `useDayContent` через `useAuth()` берёт `tz`, `lat`/`lon`, birth-поля, tier/trial для `scopeKey`, режима доступа и автодозапроса геолокации (`acquireAndPersistUserCoordinates` → **`LocationAcquireResult`**, таймаут 12s, last-known; coords в сессии даже при `persisted: false`). Без coords в профиле хук читает **`userLocationProfileCache`**, затем **async `loadDayContentCacheRelaxed`** (на native sync-`peek*` не видит SecureStore); при stale offline-cache home не блокируется пустым `need_location`. Для paid-home именно `users.birth_date` решает, можно ли запускать персональный прогноз; отдельный клиентский fetch `user_natal_charts` больше не считается обязательным блокером первого рендера. **`app/(tabs)/index.tsx`** передаёт `expectedBirthFingerprint` в `fetchActiveNatalProfileCached` для UI-карты.  
  - **`app/(tabs)/day.tsx`** — **`useAuth().authUser.id`** + **`useAppLocale().locale`** для ключа **`dayPlanCache`**; bearer для `/api/day` — через **`getSupabaseAccessSession()`** (`services/supabase.ts`), который **`AuthProvider`** подпитывает **`rememberSupabaseSession`** при каждом `onAuthStateChange`.  
  - `recentPlanetsOfDay` читается сервером из `user_settings.preferences` (см. `loadRecentPlanets` в `daily-forecast/route.ts`).  
  - После смены натала с **`app/(tabs)/profile.tsx`** главный экран может запросить **`refresh` с `blockingReload`** через **`consumeHomeDayContentBlockingReload`** (`services/homeDayContentReloadRequest.ts`) при фокусе таба Home.

- **`subscription`**  
  - `app/(tabs)/index.tsx` — `useAccess().canUseFeature("personal_daily_forecast")` и проброс tier в `useDayContent`; внутри хука ветка `nextAccessMode === "free"` vs персональный прогноз и разные базовые URL.
  - `supabase/functions/precompute-daily-forecasts/index.ts` использует серверный premium/personal gate (`membership_tier`, `trial_expires_at`) и больше не прогревает personal path для неактивных пользователей спустя 3 дня.
  - Dev test «Обновить» на Home: `services/devDayContentResetClient.ts` → `POST /api/ai/dev-day-reset` (`resetScope` через `devResetScopeForAccessMode`); legacy `POST /api/ai/global-content` `{ devReset: true }` на сервере остаётся только для `global` scope.

- **`assistant` (server monologue cache)**
  - Персональный precompute зависит от сценария `morning_recommendation` и таблицы `scenario_cache`: `supabase/functions/precompute-daily-forecasts/index.ts` заранее строит `slogan` / `short_text` / `long_explanation` / `math_level`. На обычном load **`POST /api/astro/daily-forecast`** читает тот же cache read-only через **`loadCachedMorningRecommendation`** (`morningRecommendation.ts`); Home payload собирается **`buildClientForecastPayload`** (`dailyForecastPayload.ts`) из monologue-полей, без подмешивания planning-`recommendation_short_text` из строки `user_daily_forecasts`. При `forceRefresh` — **`ensureMorningRecommendation`** (LLM).

- **`charts`**  
  - **`modules/home/ui/ChakraFlower.tsx`**: prop **`accessMode`**; цвета лепестков — **`CHAKRA_SEGMENT_COLORS`** (импорт **`getChartStrings`** снят); подпись в центре — **`strings.planetLabels[planetOfTheDay]`**; значение силы — `S_initial` планеты дня при наличии `natalProfile`, иначе нормализованная `forecast.importance`; легенда — **`strings.planetLabels`** (порядок Sun→Saturn); заголовок/подзаголовок — **`getHomeStrings` → `chakraFlower.title`**, **`captionFree`** / **`captionPersonal`** по `accessMode`.
  - **`modules/home/ui/ModalLongExplanation.tsx` / `ModalMathLevel.tsx` / `ModalAstroChart.tsx` / `SlideUpModalLayer.tsx` / `AstroChartSVG.tsx`**: home explainer-chain читает `forecast.mathLevel.structured` и `forecast.transitChart`; `ModalLongExplanation` оркестрирует stack (`HomeExplainerLevel`: `long` | `math` | `chart`) в одном RN `Modal` — math/chart через **`SlideUpModalLayer`** (`presentation="stackLayer"`, ~320 ms slide-up), не sibling `Modal`; aspects для chart — export **`chartAspectsFromMathLevel`** из `ModalMathLevel`; free-path использует `chart_mode="transit_only"` + `planet_scores` / `main_aspects` для транзитного круга без натала, paid-path — natal+transit режим с домами только при точном времени рождения.
  - **`app/(tabs)/day.tsx`**: блок «Сферы жизни» — **`DonutChart`** + **`DonutVisibilityProvider`**; веса из **`sphereStats`** (`GET /api/day`), баланс — **`calcBalance`** на клиенте.

- **`infra`**  
  - Supabase auth для JWT в клиентских fetch, таблицы `user_daily_forecasts`, `user_settings`, Edge/Vercel runtime.

## 2. От него зависят

- **`assistant` (сервер)**  
  - `_legacy_web/app/api/communicator/v2/dialog/route.ts`, `v2/greeting/route.ts`, `v2/recommendation-text/route.ts`, `v2/correct-recommendation/route.ts` читают `user_daily_forecasts` (планета дня, тексты, важность, окна) для контекста ответов. Начиная с HARMONIZER v2 daily dialog также пишет обратно `day_target_chakra`, `day_target_reason`, `day_target_fixed_at`.
  - UI-модуль `communicator` напрямую типы прогноза **не** импортирует; связь идёт через сервер и общий UX главного экрана.
  - `morning_recommendation` теперь прогревается и из daily cron: `scenario_cache` становится shared contract между `supabase/functions/precompute-daily-forecasts/index.ts` и `_legacy_web/app/api/ai/monologue/route.ts`.

- **`practices`**  
  - `app/(tabs)/index.tsx` вызывает `launchPractice` с контекстом, производным от дня (чакра/практика с главного экрана); карта планета→чакра — **`getPlanetChakraMap(locale)`** (`modules/home/planetChakra.ts`), питается `forecast.planetOfTheDay`.

## 3. Контрактные точки риска

- **Симметрия полей `DailyForecast` и snake_case в БД** — любое переименование ломает `normalizeForecast` и SQL mapping (`dailyForecastToInsert`).
- **Новый серверный контракт `day_target_*`** — home и assistant уже начинают жить на этих полях; их удаление/переименование без синхронной правки dialog-route даст тихий разрыв между прогнозом дня и daily dialog.
- **`cacheValidUntil` vs клиентский `expiresAt` в `dayContentCache`** — оба должны оставаться согласованы с локальным концом дня; расхождение Node/Edge см. open questions.
- **Пустой `recentPlanetsOfDay` на мобильном пути** — смена поведения `chooseFinalPlanet` неочевидна для QA без заполненных preferences.
- **Дубли формул Node/Deno** — правки только в одной копии дадут расхождение; опора на `daily-engine-parity.test.ts` + ручная осторожность вне покрытия теста.
- **`forceRefresh` и кэш SecureStore** — должны инвалидироваться согласованно (`clearDayContentCache` в хуке).
- **`dayPlanCache` vs prefetch snapshot** — короткий `dayPlanReloadRequest` и persisted cache решают разные задачи; смена `locale` или `userId` без инвалидации ключа даст устаревший Day tab до background refresh.
