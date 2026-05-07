---
id: 02_modules/daily_forecast/history
title: Daily_forecast History
version: 1.1
updated: 2026-05-07
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

- **2026-05:** Канонический TTL персонального прогноза на основном пути расчёта привязан к **концу локального календарного дня** (`endOfForecastDateUtc` в `computeDailyForecast.ts`), а не к фиксированным 24 часам от момента ответа. Исторический PATCH по кэшу и локальному дню заархивирован: `docs/05_archive/migrated/daily_forecast/PATCH_3_forecast_cache_timezone.md`. Остаётся зазор с частью Edge-fallback (см. `open_questions.md`).

- **2026-05:** Для снижения дрейфа между Node и Deno добавлен **parity-тест** на слой активации/важности/effectiveNatalParams: `supabase/functions/_shared/daily-engine-parity.test.ts`. Исторический документ PATCH_4 перенесён в `docs/05_archive/migrated/daily_forecast/PATCH_4_engine_parity.md`. Тест **не** гарантирует идентичность полной цепочки `computeDailyForecast` (ранжирование, финальный выбор планеты, окна) — это ограничение зафиксировано в `spec.md` и `open_questions.md`.

- **Не датировано (архив MODULE_2):** В `docs/05_archive/migrated/astrology/MODULE_2_DailyEngine_TZ.md` описан продуктовый стек «последних планет» с обновлением preferences после выбора дня. В текущем коде **запись** `user_settings.preferences.recentPlanetsOfDay` из клиентских путей не найдена; мобильный `fetchDailyForecast` не передаёт массив в теле. Каноном остаётся фактическое поведение: чтение из БД или из тела запроса, если когда-либо заполнено.

- **2026-05:** Клиентский кэш дня (`services/dayContentCache.ts`) вычисляет `expiresAt` как минимум из `forecast.cacheValidUntil` и конца локального дня по Luxon — согласовано с целью не показывать вчерашний день после смены календарной даты при корректном серверном TTL.
