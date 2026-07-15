---
id: 02_modules/subscription/spec
title: Subscription Spec
version: 1.6
updated: 2026-07-14
depends_on: [01_foundation/product_model, 02_modules/i18n/spec, 04_reference/product/tier_model]
code_refs:
  [
    modules/access/index.ts,
    modules/access/core/access.tsx,
    modules/access/core/features.ts,
    modules/access/core/tiers.ts,
    modules/access/ui/DevTierSwitch.tsx,
    modules/access/ui/AccountGateDialog.tsx,
    modules/access/ui/AccountUpsellPanel.tsx,
    app/_layout.tsx,
    app/(tabs)/_layout.tsx,
    app/(tabs)/index.tsx,
    app/(tabs)/profile.tsx,
    app/asana-practice.tsx,
    modules/practices/ui/PracticeCatalogScreen.tsx,
    modules/home/useDayContent.ts,
    services/globalContentClient.ts,
    services/dayContentCache.ts,
    _legacy_web/app/api/_utils/userModelTier.ts,
    _legacy_web/app/api/ai/global-content/route.ts,
    _legacy_web/app/api/communicator/v2/dialog/route.ts,
    _legacy_web/app/api/communicator/v2/greeting/route.ts,
    _legacy_web/app/api/communicator/v2/recommendation-text/route.ts,
    modules/access/core/paidAccess.ts,
    supabase/migrations/20260501193000_free_tier_global_content.sql,
    supabase/migrations/20260708010000_admin_panel_tier_foundation.sql,
    supabase/migrations/20260714210000_trial_one_day.sql,
  ]
---

## 1. Назначение

Модуль описывает **доступ к возможностям приложения** по данным подписки пользователя: как из профиля Supabase (`membership_tier`, `trial_expires_at`) получить эффективный продуктовый уровень и как по нему открывать или блокировать фичи в UI и на сервере. Реализация сосредоточена в пакете `modules/access`; документ фиксирует контракт этого слоя и основные точки ветвления в приложении.

## 2. Публичный контракт

Экспорт из `modules/access/index.ts` (импорт соседних модулей — через этот barrel):

- **`AccessProvider`** — React-провайдер: проп `profile` — срез `{ membership_tier?, trial_expires_at? } | null`; внутри держит локальный **dev override** эффективного тарифа. Дети получают контекст доступа.
- **`useAccess(): AccessContextValue`**
  - **`access: EffectiveAccess`** — `tier: ProductTier`, `label`, `isTrial`, `source` (`"profile" | "trial" | "dev_override"`), `devOverride`.
  - **`canUseFeature(feature: FeatureKey): boolean`** — разрешение фичи для текущего эффективного `access.tier`.
  - **`requiredTierFor(feature: FeatureKey): ProductTier`** — минимальный тариф по таблице `FEATURE_REQUIRED_TIER`.
  - **`setDevTierOverride(tier: ProductTier | null)`** — только для связки с `DevTierSwitch` / тестовых сценариев.
- **`getEffectiveAccess(profile, devOverride?)`** — чистая функция: то же вычисление, что и в провайдере (удобно для тестов и документации).
- **`canUseFeature(tier: ProductTier, feature: FeatureKey): boolean`** — статическая проверка без контекста.
- **`accessModeForTier(tier: ProductTier): "free" | "premium"`** — агрегат для слоя дневного контента (глобальный vs персональный режим загрузки прогноза).
- **Типы и константы:** `FeatureKey`, `ProductTier`, `PaidProductTier`, `EffectiveAccess`, `AccessContextValue`, `TIER_FEATURES`, `FEATURE_REQUIRED_TIER`, `PRODUCT_TIERS`, `PAID_PRODUCT_TIERS`, **`VISIBLE_PRODUCT_TIERS` / `VISIBLE_PAID_PRODUCT_TIERS`** (без legacy `practitioner`), `TIER_LABELS`, `TIER_LABELS_RU`, `TIER_ORDER`, **`tierAtLeast(tier, minimum)`**, **`isPaidProductTier`**, **`isProductTier`**.
- **`DevTierSwitch`** — UI переключателя эффективного тарифа в dev (`__DEV__`).
- **`AccountGateDialog`** (заменил `UpgradeDialog` 2026-07-14) — комплаенс-диалог заблокированной фичи по `FeatureKey`: текст `gate.body.*` из JSON-каталога + кнопки «Закрыть» и «Личный кабинет» (OTT-переход в системный браузер, см. `account_web`). Кнопка ЛК скрывается kill-switch'ем `app_config.account_links_enabled`. Внутри приложения нет цен и слов «купить/оплатить» — модель Consumption-Only.
- **`AccountUpsellPanel`** — сворачиваемая панель на главной для free-уровня («Включите индивидуальные рекомендации…», `gate.homePanel.*`), заменила прежний `FreeTierBanner`.
- Подписи уровней через **`useTranslate()`** (`tier.*` в JSON-каталоге). Админ-панель использует **`TIER_LABELS_RU`** из того же `tiers.ts`.

Вход с точки зрения данных: **идентификатор пользователя не передаётся в API модуля** — используется уже загруженный объект профиля из auth/bootstrap; поля подписки читаются из строки `users` (см. `AccessBridge` в `app/_layout.tsx`).

## 3. Внутренняя архитектура

- **`getEffectiveAccess`** (ядро): при непустом `devOverride` возвращает выбранный тариф с `source: "dev_override"`. Иначе, если `trial_expires_at` в будущем, эффективный тариф **`master`** с `source: "trial"` и подписью пробного доступа (trial даёт полный набор фич по матрице `TIER_FEATURES`). Иначе базовый тариф из **`baseTierFromRow`** (`modules/access/core/paidAccess.ts`): значения `oracle` / `practitioner` / `master` из БД проходят как есть при непустом сроке (`membership_expires_at` NULL или в будущем); истёкший грант → `free`; legacy **`premium` маппится в `oracle`**; остальное — `free`.
- **`modules/access/core/paidAccess.ts`** — единственный источник правила платного доступа по сырым полям `users` (`paidTierFromRow`, `hasActiveTrial`, `hasEffectivePremium`, `baseTierFromRow`, `accessModeFromRow`). Используется клиентом (`access.tsx`, `useDayContent`, `Communicator`) и сервером (`userModelTier.ts`, `global-content`) — vendored-копия для Vercel синхронизируется `scripts/sync-vercel-server-modules.mjs`; Edge-функция `precompute-daily-forecasts` держит зеркало (Deno bundler не резолвит `modules/`).
- **`canUseFeature(tier, key)`** — включение ключа в `TIER_FEATURES[tier]` (список на тариф).
- **Провайдер** мемоизирует `access` и замыкает `canUseFeature` на текущий `access.tier`.
 - **Потребители UI:** главный таб (`app/(tabs)/index.tsx`) — `personal_daily_forecast`, `assistant_dialog`, `calibration`, `AccountUpsellPanel`, `AccountGateDialog`; tab layout — скрытие вкладки «День», если нет `day_planning`; вкладка «Практики» видна всем (каталог — витрина), гейт стоит на «Начать практику»/«Открыть на телефоне»/«Открыть на ТВ» внутри `PracticeCatalogScreen` (по kind: `meditations`/`breath_practices`/`asana_practices`); профиль — `stats`, HARMONIZER v2 reports, dev-переключатель и кнопка «Личный кабинет» в карточке доступа; экран асаны — `asana_practices`; вебинары — `webinar_community`.
- **Параллельный контур «free / premium / trial»** для кэша и загрузки дневного контента: `modules/home/useDayContent.ts` вычисляет `AccessMode` через общий **`accessModeFromRow`** (paidAccess), `services/globalContentClient.ts` — по ответу сервера (`membership_tier` + `has_premium_access`), без вызова `getEffectiveAccess`. Ключи кэша `services/dayContentCache.ts` включают `ProductTier` (`accessTier`), который главный экран пробрасывает из `useAccess().access.tier` — смена эффективного тарифа или dev override меняет scope кэша.

Серверные зеркала «есть ли платный LLM / премиум-доступ»: `_legacy_web/app/api/_utils/userModelTier.ts` (`hasPremiumLlmAccess` → делегирует `hasEffectivePremium` из paidAccess), маршруты `global-content`, `communicator/v2/dialog`, `greeting`, `recommendation-text` — выборка `membership_tier`, `trial_expires_at`, `membership_expires_at` из `users`.

## 4. Конфигурация и параметры

- **Матрица фич** — константы в `modules/access/core/features.ts`: `TIER_FEATURES` (список `FeatureKey` на каждый `ProductTier`) и **`FEATURE_REQUIRED_TIER`** (обратное отображение: минимальный тариф для ключа). Отдельной таблицы feature gates в БД нет.
- **Продуктовая модель (с 2026-07-14, три видимых уровня):**
  - `free` → **«Навигатор»**: `global_daily_forecast`, `profile`.
  - `oracle` → **«Наставник»**: + `personal_daily_forecast`, `calibration`, `assistant_dialog`, `day_planning`, `stats` (последние три переехали с уровня practitioner).
  - `master` → **«Мастер»**: + `practice_catalog`, `breath_practices`, `meditations`, `asana_practices`, `webinar_community`.
  - `practitioner` — **скрытый legacy-уровень**: DB-значение сохранено, матрица фич = oracle, в UI/админ-выдаче не показывается (`VISIBLE_*`-константы; в `PaymentFormModal` опция видна только при редактировании существующей записи).
- **Ключ `day_planning`** — открывает вкладку «День», доступен с уровня `oracle`.
- **Ключ `stats`** — открывает как старую клиентскую статистику практик, так и новые server-backed profile reports (`/api/profile/life-matrix`, `/api/profile/practice-by-chakra`); доступен с уровня `oracle`.
- **Каталог тарифов** — единственная точка: `modules/access/core/tiers.ts` (id, порядок, `PAID_PRODUCT_TIERS`, `VISIBLE_*`, `TIER_LABELS` / `TIER_LABELS_RU`) + матрица фич в `features.ts`. Смена названий/числа тарифов в будущем правится здесь (и в SQL CHECK / RPC `recompute_user_membership`).
- **Порядок тарифов** — `TIER_ORDER` / `tierAtLeast` в `modules/access/core/tiers.ts`.
- **Схема БД** — `supabase/migrations/20260501193000_free_tier_global_content.sql` (`membership_tier`, `trial_expires_at`) + `supabase/migrations/20260708010000_admin_panel_tier_foundation.sql`: constraint расширен до `check in ('free','oracle','practitioner','master')` (данные `premium` нормализованы в `oracle`), добавлен `membership_expires_at timestamptz` (истечение ручного гранта/оплаты; NULL = бессрочно; истёкший грант = `free`). Пересчёт из леджера: `20260710023000_reconcile_expired_memberships.sql` (`recompute_user_membership`, hourly Edge). **Trial = 1 сутки** уровня «Мастер» с `20260714210000_trial_one_day.sql` (default колонки + триггер `handle_new_auth_user`, который также пишет `locale` из user_metadata email-OTP регистрации).

## 5. Известные ограничения и инварианты

- **БД и клиент согласованы (с 2026-07-08):** constraint в БД хранит те же четыре `ProductTier`, что и клиент; правило платного доступа централизовано в `paidAccess.ts`. Осталось одно намеренное зеркало — Edge-функция `precompute-daily-forecasts` (Deno не резолвит `modules/`); при изменении правила синхронизировать вручную. Правило выбора активного платежа для записи в `users` дублируется в TS (`membershipFromPayments.ts`) и SQL (`recompute_user_membership`) — при смене `TIER_ORDER` синхронизировать оба.
- **Trial → эффективный `master`:** активный trial в `getEffectiveAccess` даёт полный набор ключей как у тарифа `master`, независимо от значения `membership_tier` в БД (пока trial не истёк).
- **Dev override** хранится только в памяти процесса; на сервер и в Supabase не пишется.
- **`webinar_community`** и часть ключей заложены в матрицу для будущего UX; фактическое ветвление UI по ним может быть неполным (см. план ниже).

## 6. Текущее состояние и планируемое

**Сейчас в продакшен-данных:** поле `users.membership_tier` хранит **четырёхуровневую** модель БД (`free` / `oracle` / `practitioner` / `master`), из которых видимы три продуктовых уровня («Навигатор» / «Наставник» / «Мастер»); `trial_expires_at` — суточный полный доступ уровня «Мастер»; `membership_expires_at` — истечение гранта. Серверные проверки «премиум» делегируют общему `hasEffectivePremium`.

**Consumption-Only (реализовано 2026-07-15):** оплата в сторах не подключается — вся коммерция на внешнем сайте `zamkovoi.yoga` через OTT-переход «Личный кабинет» (модуль `account_web`). Тариф назначается: (а) вебхуком Lava.top (`payment.success`/`recurring.payment.success` → `payment_contracts` + `users.membership_tier/membership_expires_at`, период 30 дней + 48ч грейс — см. `account_web/spec.md` §3.1) или (б) вручную через админ-леджер `payments`; при истечении срока hourly cron пересчитывает membership. Смена уровня подхватывается приложением мгновенно (Realtime на `users` + foreground refetch — `MembershipEventsBridge`, см. `account_web/spec.md`). Методическая модель тарифов и терминология **free/premium в UI** — в справочнике ниже.

## Справочные материалы

- [Модель тарифов и терминология free/premium](../../04_reference/product/tier_model.md)
