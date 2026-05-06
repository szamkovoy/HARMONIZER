---
id: 02_modules/astro/history
title: Astro History
version: 1.2
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/infra/spec]
code_refs:
  [
    modules/astro-core/index.ts,
    modules/astro-core/computeNatalProfile.ts,
    modules/astro-core/ephemeris.ts,
    _legacy_web/app/api/astro/natal/route.ts,
    _legacy_web/app/api/_utils/astro-db.ts,
  ]
---

## Decision Log

- **2026-05:** Для натала выбрана геоцентрическая цепочка на пакете `astronomia` (VSOP87 + отдельные модели Солнца/Луны), версия строкой `astronomia@4.2.0` в `ephemerisLibVersion`. Это зафиксировало воспроизводимость между окружениями и упростило тестирование через `computeNatalProfileFromPositions`.

- **2026-05:** Система домов — whole sign: от асцендента при известном времени (`whole_sign_asc`) и от знака Солнца при `unknown` (`whole_sign_sun`). Массив `houseCusps` заполняется только в режиме `precise` при наличии долготы асцендента; для `approximate` куспиды в DTO не отдаются, но дома планет считаются по асценденту.

- **2026-05:** Натальный расчёт для продукта выполняется на сервере Vercel (`POST /api/astro/natal`), а не на устройстве: клиент передаёт `BirthData`, сервер вызывает `computeNatalProfileWithAstronomia` и кэширует результат в Supabase. Общая библиотека `modules/astro-core` остаётся единым местом бизнес-логики достоинств и S/H.  
  *Почему так вышло относительно ранних идей «всё на клиенте»:* клиентский расчёт на JS-эфемеридах оказался медленнее, чем тот же `astronomia` в Node на сервере; автономность натала без сети перестала быть продуктовым приоритетом, потому что без интернета всё равно недоступна генерация текстовых рекомендаций (LLM). Серверный путь упростил и **единый кэш в Supabase** для синхронизации между устройствами пользователя.

- **2026-05:** Исходные `S_initial` и `H_initial` в JSON натала считаются неизменяемыми относительно калибровки: модуль калибровки хранит отдельные calibrated поля и смешивает их уже в downstream-логике (`effectiveNatalParams` в daily-engine, см. модуль calibration).

- **2026-05:** Расхождение с `docs/05_archive/migrated/astrology/MODULE_1_AstroCore_TZ.md`: ТЗ описывает для `approximate` сценарий «середина интервала» относительно `timeIntervalMinutes`. В текущем коде `timeIntervalMinutes` только валидируется по диапазону, а момент карты для эфемерид берётся из переданного `time` как есть (`localChartDateTime` в `ephemeris.ts`). В каноне зафиксировано поведение кода; при продуктовом изменении нужно синхронно обновить UI сбора `BirthData` и этот decision log.
