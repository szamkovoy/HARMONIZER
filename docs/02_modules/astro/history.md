---
id: 02_modules/astro/history
title: Astro History
version: 1.6
updated: 2026-06-23
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

- **2026-06-23:** `natalProfileClient.ts`: сохранение натала (`createNatalProfile`) получило клиентский таймаут **30s**, чтобы modal save-path не зависал бесконечно на Home. Локальный warm-cache активной карты теперь хранит fingerprint текущих `users.birth_*`; `fetchActiveNatalProfileCached(..., { expectedBirthFingerprint })` игнорирует запись при несовпадении fingerprint-а и идёт в сеть. Причина: после повторной смены даты рождения и reopen Home мог смешивать новый прогноз дня со старой локальной натальной картой, из-за чего `ChakraFlower` показывал устаревшую силу/центр даже при уже обновлённом forecast.

- **2026-06-02:** `natalProfileClient.ts`: `fetchActiveNatalProfileCached` принимает `FetchActiveNatalProfileCachedOptions` (`onBackgroundRefresh` после warm-cache refresh); кэшированный `profile: null` больше не считается каноном при старте; сетевые ошибки чтения `user_natal_charts` не пишутся в локальный кэш как отсутствие карты. Причина: ложный `need_birth_data` на Home, когда в `users` уже есть `birth_date`, а клиентский fetch натала падал или возвращал устаревшее «нет карты».
- **2026-05-21:** Исправлен вызов `solar.apparentLongitude`: вместо сырого JDE передаётся `base.J2000Century(jde)` во всех копиях эфемерид (`modules/astro-core/ephemeris.ts`, `_legacy_web/modules/astro-core/ephemeris.ts`, `supabase/functions/_shared/dailyForecast.ts`, `_legacy_web/app/api/_utils/globalTransitMath.ts`). До правки долгота Солнца «прыгала» на коротких интервалах и смещала восход/кульминацию в окнах возможностей; регрессия — `modules/astro-core/solar-ephemeris.test.ts`.

- **2026-05-12:** Для ускорения повторных запусков мобильного приложения активный натал начали кэшировать локально в `expo-secure-store` / `localStorage` (`fetchActiveNatalProfileCached(userId)` в `services/natalProfileClient.ts`). Причина: натальная карта практически неизменна, а холодный Supabase-read мог блокировать старт главного экрана дольше, чем уже существующий кэш дневного контента. Параллельно клиентский fetch активного натала получил таймаут `10s`, чтобы зависший PostgREST не держал UI бесконечно.

- **2026-05:** Для натала выбрана геоцентрическая цепочка на пакете `astronomia` (VSOP87 + отдельные модели Солнца/Луны), версия строкой `astronomia@4.2.0` в `ephemerisLibVersion`. Это зафиксировало воспроизводимость между окружениями и упростило тестирование через `computeNatalProfileFromPositions`.

- **2026-05:** Система домов — whole sign: от асцендента при известном времени (`whole_sign_asc`) и от знака Солнца при `unknown` (`whole_sign_sun`). Массив `houseCusps` заполняется только в режиме `precise` при наличии долготы асцендента; для `approximate` куспиды в DTO не отдаются, но дома планет считаются по асценденту.

- **2026-05:** Натальный расчёт для продукта выполняется на сервере Vercel (`POST /api/astro/natal`), а не на устройстве: клиент передаёт `BirthData`, сервер вызывает `computeNatalProfileWithAstronomia` и кэширует результат в Supabase. Общая библиотека `modules/astro-core` остаётся единым местом бизнес-логики достоинств и S/H.  
  *Почему так вышло относительно ранних идей «всё на клиенте»:* клиентский расчёт на JS-эфемеридах оказался медленнее, чем тот же `astronomia` в Node на сервере; автономность натала без сети перестала быть продуктовым приоритетом, потому что без интернета всё равно недоступна генерация текстовых рекомендаций (LLM). Серверный путь упростил и **единый кэш в Supabase** для синхронизации между устройствами пользователя.

- **2026-05:** Исходные `S_initial` и `H_initial` в JSON натала считаются неизменяемыми относительно калибровки: модуль калибровки хранит отдельные calibrated поля и смешивает их уже в downstream-логике (`effectiveNatalParams` в daily-engine, см. модуль calibration).

- **2026-05:** Расхождение с `docs/05_archive/migrated/astrology/MODULE_1_AstroCore_TZ.md`: ТЗ описывает для `approximate` сценарий «середина интервала» относительно `timeIntervalMinutes`. В текущем коде `timeIntervalMinutes` только валидируется по диапазону, а момент карты для эфемерид берётся из переданного `time` как есть (`localChartDateTime` в `ephemeris.ts`). В каноне зафиксировано поведение кода; при продуктовом изменении нужно синхронно обновить UI сбора `BirthData` и этот decision log.
