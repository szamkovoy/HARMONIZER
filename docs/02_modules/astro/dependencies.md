---
id: 02_modules/astro/dependencies
title: Astro Dependencies
version: 1.3
updated: 2026-06-02
depends_on: [01_foundation/architecture, 02_modules/infra/spec]
code_refs:
  [
    modules/astro-core/index.ts,
    modules/astro-core/computeNatalProfile.ts,
    modules/astro-core/ephemeris.ts,
    _legacy_web/app/api/astro/natal/route.ts,
    _legacy_web/app/api/_utils/astro-db.ts,
    services/natalProfileClient.ts,
    _legacy_web/app/api/astro/daily-forecast/route.ts,
    supabase/functions/daily-forecast/index.ts,
  ]
---

## 1. Зависит от

- **`infra`**  
  - `_legacy_web/app/api/astro/natal/route.ts` — `runtime = "nodejs"`, `createServiceSupabase()`, запись в `user_natal_charts` и `users`, удаление из `user_daily_forecasts` через service role.  
  - `_legacy_web/app/api/astro/daily-forecast/route.ts` и `supabase/functions/daily-forecast/index.ts` — те же типы `NatalProfile`, загрузка активного натала из БД, публикация кэша прогноза.  
  - Клиент: `services/natalProfileClient.ts` — Supabase auth для JWT и `from("user_natal_charts").select(...)` для активной карты.

- **`profile` (данные и UX, без импорта модуля profile в astro-core)**  
  Сборка `BirthData` (дата, `timeMode`, время, геолокация с IANA timezone) происходит в пользовательских потоках профиля/онбординга (`app/(tabs)/index.tsx`, см. `docs/02_modules/profile/spec.md`); без этих полей серверный `POST /api/astro/natal` не получит контрактное тело.

## 2. От него зависят

- **`profile`**  
  `services/natalProfileClient.ts` вызывает `createNatalProfile` / `fetchActiveNatalProfile` / `fetchActiveNatalProfileCached`; на Home персональный прогноз gate-ится по `users.birth_date` из профиля, а клиентский fetch активной карты нужен в основном для UI (`ModalMathLevel`), не как обязательный блокер day content.

- **`daily_forecast`**  
  `modules/daily-engine/core/activation.ts` — `effectiveNatalParams`, `computeActivation`, `computeImportance` используют `natalProfile.planets[*].longitude`, `.sign`, `.house`, `.S_initial`, `.H_initial` и `precisionMode`.  
  Маршруты и Edge-функция прогноза загружают натал через `loadActiveNatalProfile` / аналог.

- **`calibration`**  
  `_legacy_web/app/api/calibration/extract/route.ts` загружает натал через `loadActiveNatalProfile`; `_legacy_web/app/api/_utils/calibration.ts` — `averageCalibration(natalProfile, ...)` читает для каждой планеты `natalProfile.planets[planet].S_initial` и `.H_initial` как базу усреднения.

- **`assistant`**  
  `_legacy_web/app/api/communicator/v2/dialog/route.ts` и `v2/greeting/route.ts` параллельно читают `user_natal_charts`, собирают `NatalProfile` через `natalProfileFromRow` и передают в компактный DTO профиля ответчика (`buildProfileCompact` / `buildResponderProfileCompact`).

- **`assistant` (косвенно, AI monologue)**  
  `_legacy_web/app/api/ai/monologue/route.ts` подгружает активный натал для контекста монолога.

## 3. Контрактные точки риска

- **Форма JSON `planets` в `user_natal_charts`** — должна десериализоваться в `Record<Planet, PlanetState>`; смена имён полей или списка планет ломает daily-engine, калибровку и промпты assistant.
- **`precisionMode`** — влияет на множители в `activation.ts` и `harmoniousness.ts`, на наличие `ascendant` и `houseCusps`, на `houseSystem`; смена семантики режимов меняет прогноз и тексты без миграции данных.
- **`S_initial` / `H_initial` (диапазоны 0..1 и -1..1 после clamp)** — зашиты в формулы Importance и в калибровочное усреднение; изменение шкалы потребует пересчёта или версии схемы.
- **`ephemeris_lib_version`** — диагностическая метка; обнуление или переименование колонки затронет `natalProfileFromRow` (fallback `"unknown"` на клиенте).
- **`loadActiveNatalProfile` / `natalProfileFromRow`** — общая утилита для нескольких маршрутов; изменение сигнатуры или состава SELECT отразится на `forecast-cache-date` и сценариях, импортирующих `astro-db`.
