---
id: 02_modules/profile/history
title: Profile History
version: 1.3
updated: 2026-05-12
depends_on: [01_foundation/architecture, 02_modules/subscription/spec, 02_modules/astro/spec]
code_refs: [modules/auth/AuthProvider.tsx, app/onboarding.tsx, app/(tabs)/profile.tsx]
---

## Decision Log

- **2026-05-12:** Cold start `AuthProvider` упрощён: удалены `resolveInitialSession()` и параллельный `getSession()`. Единственный источник сессии при холодном старте — `onAuthStateChange` (SDK сам читает SecureStore / рефрешит токен). Причина: параллельный `getSession()` захватывал внутренний lock SDK и блокировал событие `INITIAL_SESSION` при медленной сети, вызывая зависание splash. Безопасный таймаут (`AUTH_BOOTSTRAP_SAFETY_MS`) теперь передаёт `sessionRef.current` (а не `null`), чтобы не терять уже полученную сессию. В `services/supabase.ts` добавлен `AUTH_FETCH_TIMEOUT_MS` (15 с) — abort для `/auth/v1/token` fetch, чтобы зависший refresh не блокировал SDK бесконечно.

- **2026-05-12:** `fetchProfile` в `AuthProvider` получил таймаут `10s` через `AbortController` + PostgREST `.abortSignal(...)`. Причина: холодный Supabase мог задерживать ответ `users` на десятки секунд, блокируя splash-screen и downstream `useDayContent`. При таймауте логируется явное предупреждение; профиль считается `null`, и приложение продолжает с graceful degradation.

- **2026-05:** Зафиксирован разделённый контур: **Supabase Auth** (`session`) и расширенная строка **`public.users`** подтягиваются в `AuthProvider` через `select("*")` после `onAuthStateChange` / cold `getSession`; cold-start не очищает сессию при транзиентных сетевых ошибках (`resolveInitialSession`), чтобы не выбивать пользователя.

- **2026-05:** Онбординг (`app/onboarding.tsx`) записывает геолокацию и `onboarded_at` в `users` и зависит от `refreshProfile()` для согласования с остальным приложением.

- **Не датировано (MASTER_README / архитектурный снимок):** В `docs/tmp_docs/29042026/MASTER_README.md` продукт описан как связка astro-core → daily-engine → calibration → assistant с общим `UserContext` (натал, калибровка, прогноз, история практик). Текущая реализация профиля как **хаба данных** совпадает по духу (одна строка `users` + связанные таблицы), но **отдельного типа `UserContext` в одном объекте на клиенте нет** — данные разнесены по `useAuth().profile`, отдельным fetch натала и кэшам главного экрана.

- **2026-05:** Экран `app/(tabs)/profile.tsx` намеренно минимален: доступ, dev-tier, диагностика, статистика практик; расширенный редактор BirthData отложен (карточка-заглушка), основной ввод — через главный экран (`NatalBridge`).
