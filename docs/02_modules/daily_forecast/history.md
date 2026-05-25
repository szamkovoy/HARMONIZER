---
id: 02_modules/daily_forecast/history
title: Daily_forecast History
version: 2.4
updated: 2026-05-25
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/subscription/spec]
code_refs:
  [
    modules/daily-engine/computeDailyForecast.ts,
    modules/daily-engine/planetDiurnalCurve.ts,
    modules/home/ui/OpportunityWindows.tsx,
    modules/home/useDayContent.ts,
    supabase/functions/daily-forecast/index.ts,
    supabase/functions/_shared/daily-engine-parity.test.ts,
    services/dayContentCache.ts,
  ]
---

## Decision Log

- **2026-05-25:** `spec.md` — dev-кнопка «Обновить» на home: связка `clearHomeDailyDialogCache` + `postGlobalContentDevReset`; ссылка на индекс lean dialog storage в `MAP.md`.

- **2026-05-22:** Восход/кульминация — `computeDiurnalWindowTimes` (`planetDiurnalCurve.ts`) из той же сэмплированной суточной кривой, что график home (по умолчанию 96 шагов/сутки); `ephemeris.ts` и `freeWindows.ts` убрали дублирующий 10‑минутный поиск по `equatorialForPlanetAt`. Экспорты `computeDiurnalWindowTimes`, `dayFractionFromIso`; `OpportunityWindows` — доля суток маркеров через `dayFractionFromIso`. Регрессия `planet-diurnal-curve.test.ts` (восход на горизонте = X графика).

- **2026-05-21:** `OpportunityWindows` — штрих «сейчас» через `Svg` `Line` (`strokeDasharray="2 4"`) вместо сегментов `View`; цвет штриха — `theme.colors.textPrimary` (~0.28), кривая «неба» по-прежнему по чакре `graphPlanet`.

- **2026-05-21:** `OpportunityWindows` — суточная кривая через `react-native-svg` `Polyline` (вместо точек `waveDot`); цвет линии и штриха «сейчас» по `graphPlanet`; при расхождении `graphPlanet` и `planetOfTheDay` — подпись `graphTrack` в `modules/home/i18n/home.ts`.

- **2026-05-21:** `planetDiurnalCurve.ts` — общий расчёт высоты планеты над горизонтом (`planetAltitudeAt`, `samplePlanetAltitudeForDay`, `interpolateDiurnalAltitude`); `freeWindows` и график `OpportunityWindows` используют его вместо локальной/синусоидальной аппроксимации. `useDayContent` отдаёт `userLocation` на home → `OpportunityWindows`; ось графика и маркеры — доля суток в `userLocation.timezone`. Регрессия `planet-diurnal-curve.test.ts`.

- **2026-05-21:** Home UI: `ChakraFlower` — свечение выбранного лепестка без `Animated`‑пульса; `OpportunityWindows` — маркер «сейчас» обновляется при монтировании и при `AppState` → `active` (без периодического `setInterval`). *(Волна «неба» на круговой шкале `makeSkyY` заменена суточной кривой из `daily-engine` — см. запись выше.)*

- **2026-05-21:** Окна возможностей для Солнца зависят от исправления эфемерид в `astro` (`J2000Century` для `apparentLongitude`); добавлена регрессия `modules/daily-engine/windows-of-opportunity.test.ts` (Москва, восход 03–07, кульминация 11–15 локально).

- **2026-05-16:** В `user_daily_forecasts` добавлены `day_target_chakra`, `day_target_reason`, `day_target_fixed_at` (миграция **`20260516132000_life_matrix_foundation.sql`**). Сервер daily dialog теперь выбирает и фиксирует целевую чакру дня из top-3 планет с фильтром по накопленной life matrix; это даёт единый pinned target для диалога и downstream выбора практики, но не меняет сам вычислительный контракт `DailyForecast`.
- **2026-05-14 (доп.):** После **`refresh({ forceRefresh })` / `blockingReload`** для персонального дня клиент помечает **`pendingMorningMonologueForce`**: фоновый проход `morning_recommendation` выполняется с **`forceRefresh: true`** даже если базовый forecast уже содержит заполненные recommendation-поля — иначе после смены натала обновлялись числа/цветок, а тексты рекомендаций оставались от прежнего кэша сценария.

- **2026-05-14:** `useDayContent.refresh` принимает **`blockingReload`**: при `true` стартовый оверлей (`AppStartupProvider.beginHomeBootstrap`) показывается даже при `forceRefresh`, чтобы после смены натала с **`app/(tabs)/profile.tsx`** главный таб дождался нового дня под обновлённый `scopeKey`. Флаги переноса: **`markHomeDayContentBlockingReload` / `consumeHomeDayContentBlockingReload`** (`services/homeDayContentReloadRequest.ts`); потребление на фокусе Home — **`useFocusEffect`** в `app/(tabs)/index.tsx`. Общая модалка ввода даты/времени — **`modules/home/ui/NatalBirthDataModal.tsx`**.

- **2026-05-12:** `loadOpportunityWindowsExplanation` разделён на два пути по `accessMode`: free-пользователи получают упрощённый текст (только планета дня, восход, кульминация), paid — полный (натальная + транзитная планета, все окна включая точный аспект). Ранее один путь обслуживал оба режима с разной closing-фразой; теперь контент принципиально отличается.

- **2026-05-12:** Персональный `home` перестал ждать полного `morning_recommendation` до первого рендера. `daily-forecast/route.ts` теперь отдаёт быстрый базовый forecast без синхронного `ensureMorningRecommendation`, а клиентский `useDayContent` открывает экран по валидному base-слою и догружает `slogan` / short / long / `mathLevel` в фоне с последующей перезаписью day-cache. Это сознательный компромисс в пользу старта без стриминга и без смены визуального дизайна главной.

- **2026-05-12:** Free precompute глобального контента усилен: `precompute-global-recommendations` держит rolling window `yesterday/today/tomorrow`, refresh-ит строки при смене модели или пустом тексте и переводится отдельной миграцией на ежечасный cron. Цель — чтобы глобальный прогноз почти всегда уже существовал к моменту первого открытия приложения.

- **2026-05-12:** `OpportunityWindows` получил help-кнопку и модальное окно с пояснением графика; текст пояснения формируется новым сервисом `services/opportunityWindowsExplanation.ts` на основе натальной/транзитной планеты и окон. Валидация полноты forecast разделена на три уровня: `isBaseForecastValid` (минимум), `isDayContentReadyForHome` (достаточно для первого рендера home), `isDayContentComplete` (полная, с AI-текстами).

- **2026-05-12:** Контракт `windowsOfOpportunity.exactAspect` расширен полем `transitPlanet`, чтобы UI и отладочные объяснения могли явно показывать не только натальную планету аспекта, но и транзитную планету, чьё движение рисуется в окне возможностей.

- **2026-05-12:** Старт главного экрана в персональном режиме перестал жёстко зависеть от live-чтения `user_natal_charts`: `HomeScreen` теперь использует `fetchActiveNatalProfileCached(profile.id)` и тем самым может быстрее дойти до `peek/loadDayContentCache` для дневного контента. В той же итерации `fetchGlobalContent` получил общий таймаут `15s` (включая fallback-read `global_daily_content`), чтобы free-ветка не зависала бесконечно на холодном Supabase.

- **2026-05-09:** В **`DailyRecommendationCard`** строка отладки **`model: …`** под рекомендацией показывается только в **`__DEV__`** (раньше зависела от **`EXPO_PUBLIC_HARMONIZER_TEST_MODE`**).

- **2026-05:** Канонический TTL персонального прогноза на основном пути расчёта привязан к **концу локального календарного дня** (`endOfForecastDateUtc` в `computeDailyForecast.ts`), а не к фиксированным 24 часам от момента ответа. Исторический PATCH по кэшу и локальному дню заархивирован: `docs/05_archive/migrated/daily_forecast/PATCH_3_forecast_cache_timezone.md`. Остаётся зазор с частью Edge-fallback (см. `open_questions.md`).

- **2026-05:** Для снижения дрейфа между Node и Deno добавлен **parity-тест** на слой активации/важности/effectiveNatalParams: `supabase/functions/_shared/daily-engine-parity.test.ts`. Исторический документ PATCH_4 перенесён в `docs/05_archive/migrated/daily_forecast/PATCH_4_engine_parity.md`. Тест **не** гарантирует идентичность полной цепочки `computeDailyForecast` (ранжирование, финальный выбор планеты, окна) — это ограничение зафиксировано в `spec.md` и `open_questions.md`.

- **Не датировано (архив MODULE_2):** В `docs/05_archive/migrated/astrology/MODULE_2_DailyEngine_TZ.md` описан продуктовый стек «последних планет» с обновлением preferences после выбора дня. В текущем коде **запись** `user_settings.preferences.recentPlanetsOfDay` из клиентских путей не найдена; мобильный `fetchDailyForecast` не передаёт массив в теле. Каноном остаётся фактическое поведение: чтение из БД или из тела запроса, если когда-либо заполнено.

- **2026-05:** Клиентский кэш дня (`services/dayContentCache.ts`) вычисляет `expiresAt` как минимум из `forecast.cacheValidUntil` и конца локального дня по Luxon — согласовано с целью не показывать вчерашний день после смены календарной даты при корректном серверном TTL.
