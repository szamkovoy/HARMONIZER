---
id: 02_modules/profile/history
title: Profile History
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/subscription/spec, 02_modules/astro/spec]
code_refs: [modules/auth/AuthProvider.tsx, app/onboarding.tsx, app/(tabs)/profile.tsx]
---

## Decision Log

- **2026-05:** Зафиксирован разделённый контур: **Supabase Auth** (`session`) и расширенная строка **`public.users`** подтягиваются в `AuthProvider` через `select("*")` после `onAuthStateChange` / cold `getSession`; cold-start не очищает сессию при транзиентных сетевых ошибках (`resolveInitialSession`), чтобы не выбивать пользователя.

- **2026-05:** Онбординг (`app/onboarding.tsx`) записывает геолокацию и `onboarded_at` в `users` и зависит от `refreshProfile()` для согласования с остальным приложением.

- **Не датировано (MASTER_README / архитектурный снимок):** В `docs/tmp_docs/29042026/MASTER_README.md` продукт описан как связка astro-core → daily-engine → calibration → assistant с общим `UserContext` (натал, калибровка, прогноз, история практик). Текущая реализация профиля как **хаба данных** совпадает по духу (одна строка `users` + связанные таблицы), но **отдельного типа `UserContext` в одном объекте на клиенте нет** — данные разнесены по `useAuth().profile`, отдельным fetch натала и кэшам главного экрана.

- **2026-05:** Экран `app/(tabs)/profile.tsx` намеренно минимален: доступ, dev-tier, диагностика, статистика практик; расширенный редактор BirthData отложен (карточка-заглушка), основной ввод — через главный экран (`NatalBridge`).
