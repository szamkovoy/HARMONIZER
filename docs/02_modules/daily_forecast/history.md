---
id: 02_modules/daily_forecast/history
title: Daily_forecast History
version: 1.5
updated: 2026-05-12
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/subscription/spec]
code_refs:
  [
    modules/daily-engine/computeDailyForecast.ts,
    supabase/functions/daily-forecast/index.ts,
    supabase/functions/_shared/daily-engine-parity.test.ts,
    services/dayContentCache.ts,
  ]
---

## Decision Log

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
