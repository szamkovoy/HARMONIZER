---
id: 02_modules/astro/caching_strategy
title: Astro Caching Strategy
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/infra/spec, 02_modules/daily_forecast/spec]
code_refs:
  [
    _legacy_web/app/api/astro/natal/route.ts,
    _legacy_web/app/api/astro/daily-forecast/route.ts,
    _legacy_web/app/api/_utils/astro-db.ts,
    _legacy_web/app/api/calibration/extract/route.ts,
    _legacy_web/app/api/calibration/extract/forecast-cache-date.ts,
    modules/daily-engine/computeDailyForecast.ts,
    services/dayContentCache.ts,
    services/dailyForecastClient.ts,
    modules/home/useDayContent.ts,
    supabase/functions/daily-forecast/index.ts,
  ]
---

Документ описывает **серверный кэш** натала и дневного прогноза, правила **инвалидации** и **локальный календарный день**, плюс **клиентский слой** кэша дневного контента. Детали расчёта прогноза — в модуле `daily_forecast`; здесь — точка синтеза по данным, которые связывают `astro` и главный экран.

## 1. Натальный кэш (astro)

- **Таблица:** `public.user_natal_charts` (Supabase). Активная карта: `is_active = true`; версии нумеруются полем `version`.
- **Запись:** только через **service role** на Vercel (`POST` `_legacy_web/app/api/astro/natal/route.ts`): расчёт `computeNatalProfileWithAstronomia`, затем `insert`, деактивация предыдущей активной строки, обновление полей рождения в `users`.
- **Инвалидация дневного прогноза при смене натала:** в том же маршруте удаляются строки `user_daily_forecasts` с `forecast_date >= todayLocalDate(...)` для TZ из `users.tz` либо из `birthData.location.timezone` (`todayLocalDate` из `forecast-cache-date.ts`).
- **Чтение на клиенте:** `services/natalProfileClient.ts` — `SELECT` активной строки под пользовательским JWT (RLS: владелец видит свои строки).

## 2. Кэш дневного прогноза (astro + daily_forecast)

- **Таблица:** `public.user_daily_forecasts`. Поля числового движка (`importance`, `activation`, `ranked_planets`, `planet_of_the_day`, `today_planet_state`, `windows_of_opportunity`, `transit_chart`, …) пишутся из `_legacy_web/app/api/astro/daily-forecast/route.ts` или Edge-функции `supabase/functions/daily-forecast/index.ts` через `dailyForecastToInsert` (`_legacy_web/app/api/_utils/astro-db.ts`).
- **`cache_valid_until` (в API — `cacheValidUntil`):**
  - **Основной путь (Next.js + `computeDailyForecast`):** конец **локального** календарного дня для `forecast.date` в TZ пользователя: `endOfForecastDateUtc` в `modules/daily-engine/computeDailyForecast.ts` (Luxon `endOf("day").toUTC()`).
  - **Проверка попадания в кэш:** `cachedForecast` в `daily-forecast/route.ts` — строка на нужную `forecast_date` и `cache_valid_until > now()`.
  - **Edge / fallback:** в `supabase/functions/daily-forecast/index.ts` для упрощённого fallback-ответа встречается `cacheValidUntil: now + 24h` — это **не** тот же расчёт, что у Node-движка; при сравнении parity ориентироваться на Next.js + `daily-engine`.
- **Тексты рекомендаций** (`recommendation_short_text`, `recommendation_long_text`, `slogan`, `math_level`): после upsert прогноза вызывается `ensureMorningRecommendation` (`_legacy_web/app/api/_utils/morningRecommendation.ts`); при попадании в серверный кэш прогноза короткий/длинный текст могут **дозаписаться** через `persistRecommendation` в тот же ряд.

## 3. Инвалидация дневного кэша при калибровке

- **`_legacy_web/app/api/calibration/extract/route.ts`:** после успешного извлечения калибровки удаляются строки `user_daily_forecasts` с `forecast_date >= todayLocalDate(userTz)` (`userTz` из `getUserTimezone`). Это заставляет главный экран пересобрать кэш на новой калибровке без пересчёта натала.

## 4. Локальный день и TZ пользователя

- **Функция `todayLocalDate(timezone, at?)`:** `_legacy_web/app/api/calibration/extract/forecast-cache-date.ts` — календарная дата `YYYY-MM-DD` в переданной IANA-зоне для момента `at` (по умолчанию «сейчас»). Используется при выборе `forecastDate` для натала, daily-forecast, калибровки, сценарного кэша.
- **Источник TZ:** преимущественно `users.tz`; при запросе натала без сохранённого пользователя — TZ из тела `birthData.location`.

## 5. Клиентский кэш (поверх Supabase)

- **`services/dayContentCache.ts` + `modules/home/useDayContent.ts`:** после успешной загрузки полного дневного контента (прогноз + при необходимости monologue) результат кладётся в **SecureStore / web storage** с ключом по `userId`, `accessMode`, `accessTier`, `forecastDate`, `scopeKey` (рождение/локация) и **TTL** `expiresAt = min(cacheValidUntil прогноза, конец локального дня прогноза)` — см. `earlierIso` + `endOfLocalForecastDay` в `dayContentCache.ts`.
- **Смысл:** быстрый оффлайн-повтор главного экрана в пределах «свежести»; при смене дня или scope ключ не совпадает — промах и повторный fetch.
- **Связь с сервером:** клиент по-прежнему ходит в `POST /api/astro/daily-forecast` и `/api/ai/monologue`; локальный кэш не заменяет RLS и не хранит натал отдельно (натал читается из Supabase в `natalProfileClient`).

## 6. Где смотреть ещё

- Поток главного экрана и обогащение слоганом/текстами: `docs/02_modules/daily_forecast/spec.md` — раздел со ссылкой на этот файл для кэша и инвалидации.
