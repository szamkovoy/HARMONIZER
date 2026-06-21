---
id: 02_modules/profile/dependencies
title: Profile Dependencies
version: 1.9
updated: 2026-06-18
depends_on: [01_foundation/architecture, 02_modules/subscription/spec, 02_modules/astro/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/auth/AuthProvider.tsx,
    modules/auth/bootstrapRecoverSession.ts,
    modules/auth/types.ts,
    app/(tabs)/profile.tsx,
    app/(tabs)/index.tsx,
    modules/home/ui/NatalBirthDataModal.tsx,
    app/onboarding.tsx,
    services/natalProfileClient.ts,
    services/homeDayContentReloadRequest.ts,
    services/practiceSessions.ts,
    modules/location/acquireAndPersistUserCoordinates.ts,
  ]
---

## 1. Зависит от

- **`infra`**  
  Supabase (`public.users`, RLS, триггер на `auth.users`), клиент `services/supabase.ts` / типы `services/supabase-types.ts`. Без валидной конфигурации проекта и миграций строка профиля не создаётся и не обновляется.

- **`subscription`**  
  `app/_layout.tsx` передаёт `profile` в `AccessProvider`; `app/(tabs)/profile.tsx` и главный экран используют `useAccess()` для отображения тарифа, `DevTierSwitch` и `canUseFeature("stats")`. Карточки отчётов на профиле (`ProfileReportCard` / `*ReportCard`) гейтятся тем же ключом `stats`. Продуктовая семантика тарифов — в `docs/02_modules/subscription/spec.md`.

- **`astro` (данные и сценарии)**  
  `services/natalProfileClient.ts`, **`modules/home/ui/NatalBirthDataModal.tsx`** (общий с главным) и экраны `app/(tabs)/index.tsx` / `app/(tabs)/profile.tsx` завязаны на типы `BirthData` / `NatalProfile` из `modules/astro-core` и API `POST /api/astro/natal`. Поля `birth_*` и связанный активный натал определяют персональный прогноз и downstream assistant/calibration.

- **`daily_forecast` (синхронизация главного после смены натала с профиля)**  
  После успешного `createNatalProfile` с вкладки профиля вызывается **`markHomeDayContentBlockingReload`** (`services/homeDayContentReloadRequest.ts`); при следующем фокусе **`app/(tabs)/index.tsx`** потребляется флаг и **`useDayContent.refresh`** выполняется с **`blockingReload`** + при необходимости **`forceRefresh`**, чтобы главный экран дождался обновлённого дня под новый `scopeKey`.

- **`practices` (агрегаты)**  
  Экран профиля читает **`loadDailyPracticeStats`** из `services/practiceSessions.ts` (таблица завершённых сессий). Запись сессий выполняется из flow практик, не из таба профиля.

- **`i18n` / `life-spheres`**  
  Отчёты и chrome профиля: **`useAppLocale().locale`** → `getProfileReportStrings` / `getPeriodPresets`; подписи сфер в donut — **`localizeLifeSphereLabel`** (`modules/life-spheres/labels.ts`, нативные заголовки для всех 8 `AppContentLocale`).

- **`charts`**  
  Donut-отчёты рендерятся через **`DonutChart`** (`modules/charts/`): сегменты, дуга баланса, центр `{balance}%`, scroll-triggered animation; провайдер **`DonutVisibilityProvider`** на **`app/(tabs)/profile.tsx`**.

- **`assistant` (новые отчёты HARMONIZER v2)**
  Profile reports через backend routes: `life-matrix` сначала читает `profile_report_snapshots`, а при miss/version-mismatch пересобирает его из compact day-rollup слоя `daily_matrices`; `practice-by-chakra` — завершённые `practice_sessions`. Легенда чакр — **`buildChakraLegend()`** (`planetChakraLegend.ts`), без импорта клиентского `modules/home/planetChakra`.

## 2. От него зависят

- **`daily_forecast`**  
  `useDayContent` и главный экран читают `profile` из `useAuth()` (tz, координаты, birth fields, tier) для выбора режима контента и scope кэша; смена birth с профиля инициирует отложенный **`blockingReload`** главного через `homeDayContentReloadRequest` (см. §1). Вкладка **`app/(tabs)/day.tsx`** дополнительно использует **`authUser.id`** для ключа **`dayPlanCache`**; **`loadDayPlan`** берёт Bearer через **`getSupabaseAccessSession`**, который **`AuthProvider`** подпитывает **`rememberSupabaseSession`**.

- **`subscription`**  
  Тот же объект `profile` — вход `AccessProvider`; без актуальных `membership_tier` / `trial_expires_at` ломается вся матрица gate.

- **`astro`**  
  Поток сохранения натала обновляет `users` и `user_natal_charts`; см. парную запись в `docs/02_modules/astro/dependencies.md` §1–2.

- **`calibration`**, **`assistant`**, **`communicator` (косвенно)**  
  Серверные маршруты загружают строку пользователя и натал независимо от UI профиля; клиентский профиль должен быть согласован после локальных изменений через `refreshProfile()`.
- **`assistant` (прямой потребитель отчётов)**  
  `_legacy_web/app/api/profile/life-matrix/route.ts` и `practice-by-chakra/route.ts` теперь отдают profile-specific агрегаты поверх артефактов ассистента; это новая парная связь `profile` -> `assistant`.

- **`practices`**  
  Статистика на экране профиля — потребитель `practice_sessions` по `user_id`. Парная пометка добавлена в `docs/02_modules/practices/dependencies.md`.

## 3. Контрактные точки риска

- **Форма `birth_place` (jsonb)** и согласованность с `BirthData.location` при сериализации в API натала.
- **`membership_tier` / `trial_expires_at`** — расхождение с серверными дублями правил доступа (см. open questions по `subscription`).
- **`refreshProfile` не вызван** после ручного или серверного изменения `users` — UI покажет устаревший тариф или геоданные до следующего auth-события.
- **Race `profileLoading`:** экраны, не ждущие готовности профиля, могут один кадр отрисовать пустые поля.
