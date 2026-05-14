---
id: 02_modules/profile/spec
title: Profile Spec
version: 1.7
updated: 2026-05-14
depends_on: [01_foundation/architecture, 02_modules/subscription/spec, 02_modules/astro/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/auth/AuthProvider.tsx,
    modules/auth/bootstrapRecoverSession.ts,
    modules/auth/useAuth.ts,
    modules/auth/types.ts,
    app/(tabs)/profile.tsx,
    app/(tabs)/index.tsx,
    modules/home/ui/NatalBirthDataModal.tsx,
    app/onboarding.tsx,
    app/_layout.tsx,
    services/supabase.ts,
    services/natalProfileClient.ts,
    services/homeDayContentReloadRequest.ts,
    services/practiceSessions.ts,
    modules/location/acquireAndPersistUserCoordinates.ts,
    _legacy_web/app/api/astro/natal/route.ts,
  ]
---

## 1. Назначение

Модуль **profile** в рантайме — это совокупность **данных пользователя из `public.users`**, синхронизируемых с Supabase Auth, и **экранов**, где эти данные отображаются или инициируют downstream-действия (натал, геолокация, тариф, статистика практик). Каноническая загрузка и обновление строки профиля сосредоточены в **`modules/auth/AuthProvider.tsx`**; вкладка **`app/(tabs)/profile.tsx`** даёт минимальный UI поверх `useAuth()` и `useAccess()`.

## 2. Публичный контракт

- **`useAuth()`** (`modules/auth/useAuth.ts`) внутри `AuthProvider` возвращает **`AuthContextValue`** (`modules/auth/types.ts`):
  - **`session`**, **`authUser`** — стандартные объекты Supabase (`Session`, `User`).
  - **`profile: AuthUserRow | null`** — полная строка **`public.users`** по `id = auth.users.id`, тип **`Database["public"]["Tables"]["users"]["Row"]`** (`services/supabase-types.ts`). Поля, от которых зависят другие домены, включают среди прочих: `birth_date`, `birth_time`, `birth_place`, `tz`, `lat`, `lon`, `location_name`, `locale`, `membership_tier`, `trial_expires_at`, `display_name`, `avatar_url`, `onboarded_at`.
  - **`profileLoading`**, **`initializing`**, **`signingIn`** — флаги жизненного цикла.
  - **`signInWithApple`**, **`signInWithGoogle`**, **`signOut`**.
  - **`refreshProfile()`** — повторный `select * from users` для текущего `session.user` (нужно после операций, меняющих строку в БД, например после `createNatalProfile` или онбординга).

Прямого отдельного пакета `modules/profile` нет: **публичный контракт профиля = типы и методы `modules/auth` + сервисы**, которые пишут в `users` или связанные таблицы.

## 3. Внутренняя архитектура

- **Источник строки `users`:** при событиях `supabase.auth.onAuthStateChange` вызывается **`syncProfile`**, который делает `from("users").select("*").eq("id", userId).maybeSingle()`. Сетевой запрос защищён таймаутом `PROFILE_FETCH_TIMEOUT_MS` (10 с) через `AbortController` + `.abortSignal(...)`, чтобы зависший PostgREST не блокировал сплэш-скрин бесконечно. Строка создаётся на стороне БД триггером на нового пользователя (`handle_new_auth_user`, см. миграции Supabase — задокументировано в комментариях `AuthProvider`). Cold start полностью полагается на `onAuthStateChange` (SDK сам читает SecureStore и рефрешит токен); отдельный вызов `getSession()` удалён, чтобы не захватывать внутренний lock SDK и не блокировать событие `INITIAL_SESSION` при медленной сети. Таймаут auth token refresh (15 с) реализован в `services/supabase.ts` через `AbortController` на `/auth/v1/token`. В **`__DEV__`** `services/supabase-auth-console-filter.ts` понижает до `console.warn` типичные транзиенты auth-js: **`AuthRetryableFetchError`** и **`AbortError: Aborted`** из RN `whatwg-fetch` при этом abort (чтобы не засорять LogBox красным оверлеем). Завершение cold start: **`session` и `initializing` обновляются одним `setState`**, чтобы гейт в `app/_layout.tsx` не видел кадр с «уже не сплэш, но session ещё null»; при первом `INITIAL_SESSION` с `session === null` bootstrap завершается с задержкой ~1,2 с, чтобы поймать редкий второй колбэк с реальной сессией. Если после этого SDK всё ещё даёт «пусто», но в SecureStore осталась сессия GoTrue (транзиентный `Network request failed` на refresh), **`readPersistedAuthSessionFromStorage`** в `services/supabase.ts` читает JSON без lock, а **`recoverAuthSessionFromPersistedStorageWithRetries`** (`modules/auth/bootstrapRecoverSession.ts`) синхронизирует клиент через `auth.setSession` с несколькими попытками — иначе пользователь ошибочно попадал бы на `/sign-in`. Safety bootstrap (`AUTH_BOOTSTRAP_SAFETY_MS`, сейчас 35 с) использует тот же путь, а не `sessionRef` (на cold start он до первого commit всегда `null`). Редирект на `/sign-in` при `session === null` после того как сессия уже была в этом рантайме, откладывается на ~0,5 с, чтобы пережить кратковременный `null` от SDK/refresh без мигания экрана входа.
- **Корневой layout:** `app/_layout.tsx` оборачивает дерево в `AuthProvider`, затем `AccessBridge` передаёт **`profile`** в `AccessProvider` (`modules/access`) для подписочных gate.
- **Редактирование натальных / BirthData:** **`app/(tabs)/index.tsx`** и **`app/(tabs)/profile.tsx`** — общий UI **`NatalBirthDataModal`** + `createNatalProfile` → `POST /api/astro/natal`. Сервер (`_legacy_web/app/api/astro/natal/route.ts`) обновляет `users.birth_*`, `lat`/`lon`/`tz` при необходимости, пересобирает `user_natal_charts`, **удаляет** `user_daily_forecasts` с текущей локальной даты и далее.
- **Онбординг:** `app/onboarding.tsx` пишет в `users` поля `tz`, `lat`, `lon`, `location_name`, `onboarded_at` и вызывает `refreshProfile()`.
- **Геолокация для прогноза:** `modules/location/acquireAndPersistUserCoordinates.ts` обновляет `lat`, `lon`, `tz`, опционально `location_name` без смены birth-полей.

## 4. UI: `app/(tabs)/profile.tsx`

- Карточка **«Текущий доступ»:** `access` из `useAccess()`, сырые `profile.membership_tier` и `trial_expires_at`, кнопка **«Обновить профиль»** → модальное окно **`NatalBirthDataModal`** (`modules/home/ui/NatalBirthDataModal.tsx`): ввод даты/времени рождения и **`createNatalProfile`** (как на главном); при открытии в поля подставляются **`initialDate` / `initialTime`** из **`profile.birth_date` / `profile.birth_time`** (если есть). Доступ к редактированию по фиче **`calibration`** (`useAccess().canUseFeature("calibration")`); иначе **`UpgradeDialog`**. После успешного сохранения: **`refreshProfile()`**, **`markHomeDayContentBlockingReload({ forceRefresh: true })`** (`services/homeDayContentReloadRequest.ts`) — при следующем фокусе главного таба `useDayContent.refresh` выполняется с **`blockingReload`** и показывает стартовый оверлей до готовности дня; **`Alert`** с переходом **`router.push("/calibration")`** или **`router.replace("/")`**.
- В **`__DEV__`:** `DevTierSwitch` для эффективного тарифа (см. `subscription`).
- **Статистика практик:** при `canUseFeature("stats")` — загрузка `loadDailyPracticeStats` из `services/practiceSessions.ts` (14 дней); иначе текст про тариф Практик/Мастер.
- **`HARMONIZER_TEST_MODE` / `__DEV__`:** блок диагностики (`runtimeDiagnostics`).
- Заглушка **«Скоро здесь»** — расширенные настройки профиля (не birth-редактор; birth — см. кнопку выше).

## 5. Конфигурация и параметры

- Схема и ограничения колонок **`public.users`** задаются SQL-миграциями в `supabase/migrations/*` и отражены в **`services/supabase-types.ts`**.
- URL Supabase для отладочного логирования fetch профиля собирается в **`getProfileRequestUrl`** внутри `AuthProvider` (не меняет контракт).

## 6. Интеграции

- **`subscription`:** тариф и trial читаются из `profile`; эффективный tier и `canUseFeature` — через `AccessProvider`. Подробности модели тарифов не дублируются здесь — см. **`docs/02_modules/subscription/spec.md`** и справочник по ссылке ниже.
- **`astro`:** персональный прогноз и натал зависят от полей профиля и результата `createNatalProfile`; клиентский контракт BirthData/`NatalProfile` — `modules/astro-core`, вызовы в `services/natalProfileClient.ts`.
- **`practices`:** экран профиля читает статистику завершённых сессий через **`practice_sessions`** (сервис `practiceSessions`), без записи новых сессий с этого экрана.
- **`communicator` / `assistant`:** не импортируют экран профиля; серверные маршруты сами выбирают `users` и натал для диалога. Обновление профиля после смены birth data на клиенте косвенно влияет на последующие запросы диалога после `refreshProfile`.

## 7. Известные ограничения и инварианты

- **Смена BirthData через натальный API** инвалидирует активные строки **`user_natal_charts`** (старые версии деактивируются) и **часть кэша прогноза** (`user_daily_forecasts` с даты ≥ сегодня в tz пользователя) — см. `natal/route.ts`.
- **Смена текущих координат / tz** (онбординг, `acquireAndPersistUserCoordinates`) меняет вводные для расчёта локального дня и геозависимых веток без автоматического пересчёта натала; персональный прогноз должен перезапрашиваться через существующие refresh-потоки главного экрана.
- **Поле `profile` не кэшируется** между приложениями иначе как через Supabase: после внешних изменений строки в БД нужен **`refreshProfile`** (или пере-login).
- Расширенное редактирование профиля (имя, аватар, палитра и т.п.) в UI таба **ещё не реализовано** (см. карточку «Скоро здесь»).

## Справочные материалы

- Модель тарифов и терминология **free/premium** в продукте: не пересказывать в этом файле — **[tier_model.md](../../04_reference/product/tier_model.md)** и контекст доступа **[subscription/spec.md](../subscription/spec.md)** (раздел «Справочные материалы» там ведёт на тот же reference).
