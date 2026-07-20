---
id: 02_modules/subscription/dependencies
title: Subscription Dependencies
version: 1.5
updated: 2026-07-14
depends_on: [01_foundation/product_model, 02_modules/i18n/spec, 04_reference/product/tier_model]
code_refs:
  [
    modules/access/core/access.tsx,
    modules/access/core/features.ts,
    modules/access/core/paidAccess.ts,
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
  Схема Postgres (`users.membership_tier`, `trial_expires_at`, `membership_expires_at`, индексы) — `supabase/migrations/20260501193000_free_tier_global_content.sql` + `20260708010000_admin_panel_tier_foundation.sql`.  
  Серверные маршруты Next.js на Vercel (`_legacy_web/app/api/ai/global-content/route.ts`, communicator `v2/*`) читают те же поля и отдают клиенту признаки доступа.  
  Типы строки пользователя в клиенте — `services/supabase-types.ts` (генерация из схемы).

- **Данные профиля / auth (без отдельной строки в MAP)**  
  `app/_layout.tsx` (`AccessBridge`) передаёт в `AccessProvider` объект `profile` из `useAuth()`. Поля подписки приходят из той же загрузки пользователя, что и остальной профиль; модуль не вызывает Supabase сам по тарифу.

- **`i18n`**  
  `modules/access/ui/AccountGateDialog.tsx` / `AccountUpsellPanel.tsx` — `useTranslate()` для `tier.*` и `gate.*` (комплаенс-тексты точек гейтинга, панель главной, модалки trial/смены уровня). Новые ключи — в `modules/i18n/catalog/ru.json` + sync gate.

- **`account_web`**  
  Кнопка «Личный кабинет» в `AccountGateDialog` / `AccountUpsellPanel` вызывает `openAccountCabinet()` из `modules/account` (OTT-переход) и скрывается по kill-switch `useAccountLinksEnabled()` (`app_config.account_links_enabled`). Подхват смены уровня — `MembershipEventsBridge` (см. `02_modules/account_web/`).

## 2. От него зависят

- **`daily_forecast`**  
  `app/(tabs)/index.tsx` — `useAccess().canUseFeature("personal_daily_forecast")` определяет, нужен ли натал и персональный прогноз; `accessModeForTier(access.tier)` и `access.tier` пробрасываются в `useDayContent` как override режима и tier для кэша.  
  `modules/home/useDayContent.ts` — параллельно вычисляет `AccessMode` из сырых полей профиля для запросов к `global-content` и персональному прогнозу (должен оставаться согласован с правилами trial в `getEffectiveAccess`).

- **`profile`**  
  `app/(tabs)/profile.tsx` — отображение `access.label`, `TIER_LABELS[access.tier]`, сырых `membership_tier` / `trial_expires_at`; `canUseFeature("stats")` открывает блок статистики практик и новые HARMONIZER v2 reports; в `__DEV__` рендерится `DevTierSwitch`.

- **`assistant` (сервер)**  
  `_legacy_web/app/api/communicator/v2/dialog/route.ts` — выборка `membership_tier`, `trial_expires_at` для DTO и связки с `_legacy_web/app/api/_utils/userModelTier.ts` (`dialogSurfaceModelHint` / премиум-модели); `hasActiveTrial` / `baseTierFromRow` задают `offerCatalogPractice` в `initFsmState` (ветка practice только Master/trial).

- **`communicator`**  
  `modules/communicator/ui/Communicator.tsx` — `tierLabelFromProfile` для подписи тарифа в UI (через общий `hasEffectivePremium` из paidAccess).  
  Клиентский транспорт не проверяет фичи сам; ограничения «открыть диалог» задаются на главном экране через `canUseFeature("assistant_dialog")`.

- **`practices`**  
  `app/(tabs)/_layout.tsx` — таб «Практики» виден всем уровням (каталог — витрина).  
  `modules/practices/ui/PracticeCatalogScreen.tsx` — гейт на «Начать практику» через `practice_catalog` / `asana_practices`, `AccountGateDialog`.  
  `app/asana-practice.tsx` — без `asana_practices` не загружается контент Vimeo и показывается `AccountGateDialog`.

- **`biofeedback`** (косвенно)  
  Отдельного `FeatureKey` для биофидбека нет; доступ к дыхательным практикам с камерой ограничивается тем же тарифом, что и ключ `breath_practices` / экраны в `practices`. Парная формулировка — `docs/02_modules/biofeedback/dependencies.md`.

- **`webinars`**  
  `modules/webinars/ui/WebinarScreen.tsx` — регистрация на вебинар и записи гейтятся `webinar_community` (уровень «Мастер»), блокировка показывает `AccountGateDialog` с текстом `gate.body.webinar`.

- **`admin_panel`**  
  Миграция 4 тиров + `membership_expires_at` (этап 0); ручной грант/правка платежей (этап 6) пишет леджер и пересчитывает `users.membership_*` по правилу highest active tier. Подписи в UI админки — `TIER_LABELS_RU`. См. `02_modules/admin_panel/`.

- **`infra`**  
  Hourly Edge `reconcile-expired-memberships` + SQL `recompute_user_membership` / `reconcile_expired_memberships` поддерживают актуальность `users.membership_*` после истечения `membership_expires_at` без интерактивного захода в админку.

## 3. Контрактные точки риска

- **Единая точка правила платного доступа:** `modules/access/core/paidAccess.ts` (клиент + сервер через vendored-копию `scripts/sync-vercel-server-modules.mjs`). Намеренное зеркало осталось только в Edge `precompute-daily-forecasts` (`hasPersonalForecastAccess`) — при изменении правила синхронизировать вручную. Ответы `global-content` несут `has_premium_access` для клиента.
- **Изменение `FeatureKey` или `TIER_FEATURES`** — ломает все вызовы `canUseFeature` и маппинг `FEATURE_BODY_KEY` в `AccountGateDialog` (`gate.body.*` в каталоге); нужна проходка по `app/(tabs)/*`, `modules/practices/*`, `app/asana-practice.tsx`, `modules/webinars/*`.
- **Ключ `stats` стал шире по смыслу** — теперь он гейтит и server-backed reports профиля, так что ошибки в `TIER_FEATURES` затронут не только локальную статистику практик, но и life matrix / range trend.
- **Смена `ProductTier` или порядка в `TIER_ORDER`** — влияет на `accessModeForTier` и на сравнения `tierAtLeast` у будущих потребителей.
- **Кэш дня** (`services/dayContentCache.ts`) ключует по `accessTier`; смена правил tier без инвалидации может показывать старый персональный/global контент до принудительного refresh.
