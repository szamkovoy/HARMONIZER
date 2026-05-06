---
id: 02_modules/daily_forecast/spec
title: Daily_forecast Spec
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/subscription/spec]
code_refs: [app/(tabs)/index.tsx, modules/home/useDayContent.ts, services/dailyForecastClient.ts]
---

## TODO: наполнить на этапе миграции.

Здесь будет описание формирования дневного прогноза, главного экрана и рекомендаций.
Файл зафиксирует пользовательский поток между forecast, upgrade surfaces и переходами к assistant/practices.
## Кэш и локальный день

Серверные и клиентские слои кэша (`user_natal_charts`, `user_daily_forecasts`, `cache_valid_until`, инвалидация при натале и калибровке, клиентский `dayContentCache`) и правило локальной даты описаны в `docs/02_modules/astro/caching_strategy.md` как синтез между `astro` и этим модулем.

## Справочные материалы

Для текущего расчёта daily forecast напрямую используются в первую очередь:

- docs/04_reference/astrology/activation_and_importance.md
- docs/04_reference/astrology/windows_of_opportunity.md
- docs/04_reference/astrology/essential_dignities.md
- docs/04_reference/astrology/accidental_dignities.md
- docs/04_reference/astrology/harmoniousness.md
