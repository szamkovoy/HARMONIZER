---
id: 02_modules/subscription/dependencies
title: Subscription Dependencies
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/product_model, 04_reference/product/tier_model]
code_refs:
  [
    modules/access/core/access.tsx,
    modules/access/core/features.ts,
    modules/access/core/tiers.ts,
    app/_layout.tsx,
    app/(tabs)/_layout.tsx,
    app/(tabs)/index.tsx,
    app/(tabs)/profile.tsx,
    app/asana-practice.tsx,
    modules/practices/ui/PracticeCatalogScreen.tsx,
    modules/home/useDayContent.ts,
    services/globalContentClient.ts,
    _legacy_web/app/api/_utils/userModelTier.ts,
    _legacy_web/app/api/ai/global-content/route.ts,
    _legacy_web/app/api/communicator/v2/dialog/route.ts,
  ]
---

## 1. Зависит от

- **`infra`**  
  Схема Postgres (`users.membership_tier`, `trial_expires_at`, индексы) — `supabase/migrations/20260501193000_free_tier_global_content.sql`.  
  Серверные маршруты Next.js на Vercel (`_legacy_web/app/api/ai/global-content/route.ts`, communicator `v2/*`) читают те же поля и отдают клиенту признаки доступа.  
  Типы строки пользователя в клиенте — `services/supabase-types.ts` (генерация из схемы).

- **Данные профиля / auth (без отдельной строки в MAP)**  
  `app/_layout.tsx` (`AccessBridge`) передаёт в `AccessProvider` объект `profile` из `useAuth()`. Поля подписки приходят из той же загрузки пользователя, что и остальной профиль; модуль не вызывает Supabase сам по тарифу.

## 2. От него зависят

- **`daily_forecast`**  
  `app/(tabs)/index.tsx` — `useAccess().canUseFeature("personal_daily_forecast")` определяет, нужен ли натал и персональный прогноз; `accessModeForTier(access.tier)` и `access.tier` пробрасываются в `useDayContent` как override режима и tier для кэша.  
  `modules/home/useDayContent.ts` — параллельно вычисляет `AccessMode` из сырых полей профиля для запросов к `global-content` и персональному прогнозу (должен оставаться согласован с правилами trial в `getEffectiveAccess`).

- **`profile`**  
  `app/(tabs)/profile.tsx` — отображение `access.label`, `TIER_LABELS[access.tier]`, сырых `membership_tier` / `trial_expires_at`; `canUseFeature("stats")` открывает блок статистики практик; в `__DEV__` рендерится `DevTierSwitch`.

- **`assistant` (сервер)**  
  `_legacy_web/app/api/communicator/v2/dialog/route.ts` — выборка `membership_tier`, `trial_expires_at` для DTO и связки с `_legacy_web/app/api/_utils/userModelTier.ts` (`dialogSurfaceModelHint` / премиум-модели).

- **`communicator`**  
  `modules/communicator/ui/Communicator.tsx` — локальная функция `tierLabelFromProfile` для подписи тарифа в UI (зеркалит free/premium + trial).  
  Клиентский транспорт не проверяет фичи сам; ограничения «открыть диалог» задаются на главном экране через `canUseFeature("assistant_dialog")`.

- **`practices`**  
  `app/(tabs)/_layout.tsx` — `href: null` на таб «Практики», если `!canUseFeature("practice_catalog")`.  
  `modules/practices/ui/PracticeCatalogScreen.tsx` — блокировки каталога и асан через `practice_catalog` / `asana_practices`, `UpgradeDialog`.  
  `app/asana-practice.tsx` — без `asana_practices` не загружается контент Vimeo и показывается апгрейд.

- **`biofeedback`** (косвенно)  
  Отдельного `FeatureKey` для биофидбека нет; доступ к дыхательным практикам с камерой ограничивается тем же тарифом, что и ключ `breath_practices` / экраны в `practices`. Парная формулировка — `docs/02_modules/biofeedback/dependencies.md`.

- **`webinars` / `author_presence` (план в MAP)**  
  В `TIER_FEATURES` зарезервированы ключи в духе `webinar_community`; отдельного потребительского кода под эти модули в репозитории пока нет.

## 3. Контрактные точки риска

- **Синхронизация трёх слоёв:** `getEffectiveAccess` + дубли `hasPremiumAccess` / `hasPremiumLlmAccess` + ответы `global-content` (`has_premium_access`). Расхождение даёт неверный режим прогноза или модель LLM.
- **Изменение `FeatureKey` или `TIER_FEATURES`** — ломает все вызовы `canUseFeature` и тексты `UpgradeDialog`; нужна проходка по `app/(tabs)/*`, `modules/practices/*`, `app/asana-practice.tsx`.
- **Смена `ProductTier` или порядка в `TIER_ORDER`** — влияет на `accessModeForTier` и на сравнения `tierAtLeast` у будущих потребителей.
- **Кэш дня** (`services/dayContentCache.ts`) ключует по `accessTier`; смена правил tier без инвалидации может показывать старый персональный/global контент до принудительного refresh.
