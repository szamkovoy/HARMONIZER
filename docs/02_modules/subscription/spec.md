---
id: 02_modules/subscription/spec
title: Subscription Spec
version: 1.2
updated: 2026-05-16
depends_on: [01_foundation/product_model, 04_reference/product/tier_model]
code_refs:
  [
    modules/access/index.ts,
    modules/access/core/access.tsx,
    modules/access/core/features.ts,
    modules/access/core/tiers.ts,
    modules/access/ui/DevTierSwitch.tsx,
    modules/access/ui/UpgradeDialog.tsx,
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
    supabase/migrations/20260501193000_free_tier_global_content.sql,
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
- **Типы и константы:** `FeatureKey`, `ProductTier`, `EffectiveAccess`, `AccessContextValue`, `TIER_FEATURES`, `FEATURE_REQUIRED_TIER`, `PRODUCT_TIERS`, `TIER_LABELS`, `TIER_ORDER`, **`tierAtLeast(tier, minimum)`**.
- **`DevTierSwitch`** — UI переключателя эффективного тарифа в dev (`__DEV__`).
- **`UpgradeDialog`** — модалка апгрейда по `FeatureKey` + `requiredTierFor` (подписи тарифов из `TIER_LABELS`).

Вход с точки зрения данных: **идентификатор пользователя не передаётся в API модуля** — используется уже загруженный объект профиля из auth/bootstrap; поля подписки читаются из строки `users` (см. `AccessBridge` в `app/_layout.tsx`).

## 3. Внутренняя архитектура

- **`getEffectiveAccess`** (ядро): при непустом `devOverride` возвращает выбранный тариф с `source: "dev_override"`. Иначе, если `trial_expires_at` в будущем, эффективный тариф **`master`** с `source: "trial"` и подписью пробного доступа (trial даёт полный набор фич по матрице `TIER_FEATURES`). Иначе базовый тариф из **`profileTier`**: значения `oracle` / `practitioner` / `master` из БД проходят как есть; **`premium` маппится в `oracle`**; остальное — `free`.
- **`canUseFeature(tier, key)`** — включение ключа в `TIER_FEATURES[tier]` (список на тариф).
- **Провайдер** мемоизирует `access` и замыкает `canUseFeature` на текущий `access.tier`.
 - **Потребители UI:** главный таб (`app/(tabs)/index.tsx`) — `personal_daily_forecast`, `assistant_dialog`, `calibration`, баннер free-tier, `UpgradeDialog`; tab layout — скрытие вкладки «День», если нет `day_planning`, и вкладки «Практики», если нет `practice_catalog`; профиль — `stats`, HARMONIZER v2 reports и dev-переключатель; каталог практик и экран асаны — `practice_catalog` / `asana_practices`.
- **Параллельный контур «free / premium / trial»** для кэша и загрузки дневного контента: `modules/home/useDayContent.ts` и `services/globalContentClient.ts` вычисляют `AccessMode` по **сырым** `membership_tier` + `trial_expires_at` (логика «как `hasPremiumAccess`»), без вызова `getEffectiveAccess`. Ключи кэша `services/dayContentCache.ts` включают `ProductTier` (`accessTier`), который главный экран пробрасывает из `useAccess().access.tier` — смена эффективного тарифа или dev override меняет scope кэша.

Серверные зеркала «есть ли платный LLM / премиум-доступ»: `_legacy_web/app/api/_utils/userModelTier.ts` (`hasPremiumLlmAccess`), маршруты `global-content`, `communicator/v2/dialog`, `greeting`, `recommendation-text` — выборка `membership_tier`, `trial_expires_at` из `users`.

## 4. Конфигурация и параметры

- **Матрица фич** — константы в `modules/access/core/features.ts`: `TIER_FEATURES` (список `FeatureKey` на каждый `ProductTier`) и **`FEATURE_REQUIRED_TIER`** (обратное отображение: минимальный тариф для ключа). Отдельной таблицы feature gates в БД нет.
- **Ключ `day_planning`** — открывает вкладку «День» и доступен на тарифах `practitioner` и `master`.
- **Ключ `stats`** — открывает как старую клиентскую статистику практик, так и новые server-backed profile reports (`/api/profile/life-matrix`, `/api/profile/practice-by-chakra`).
- **Порядок тарифов** — `TIER_ORDER` / `tierAtLeast` в `modules/access/core/tiers.ts`.
- **Схема БД** — `supabase/migrations/20260501193000_free_tier_global_content.sql`: `users.membership_tier` с `check in ('free','premium')`, `trial_expires_at`; комментарии в миграции описывают семантику trial для `free`.

## 5. Известные ограничения и инварианты

- **Расхождение БД и клиентской типизации:** в коде объявлены четыре `ProductTier` и набор фич под них, а **constraint в БД пока только `free` / `premium`**. Строки `oracle` / `practitioner` / `master` в `membership_tier` поддержаны в `profileTier` на клиенте, но **не enforced** на уровне текущей миграции SQL.
- **Дублирование правил trial/premium:** сервер и `useDayContent` повторяют условие «`premium` ИЛИ (`free` И trial не истёк)»; при изменении правил нужно синхронизировать `getEffectiveAccess`, `useDayContent`, `userModelTier`, `global-content` и клиентов, читающих ответ API.
- **Trial → эффективный `master`:** активный trial в `getEffectiveAccess` даёт полный набор ключей как у тарифа `master`, независимо от значения `membership_tier` в БД (пока trial не истёк).
- **Dev override** хранится только в памяти процесса; на сервер и в Supabase не пишется.
- **`webinar_community`** и часть ключей заложены в матрицу для будущего UX; фактическое ветвление UI по ним может быть неполным (см. план ниже).

## 6. Текущее состояние и планируемое

**Сейчас в продакшен-данных:** поле `users.membership_tier` — **`free` / `premium`**, плюс `trial_expires_at` для трёхдневного полного доступа на free. Клиент и часть API уже используют **четырёхуровневую** модель тарифов и `canUseFeature` для ветвления; серверные проверки «премиум» для LLM и глобального контента опираются на **двоичную** модель `hasPremiumAccess` / `hasPremiumLlmAccess`.

**План:** довести хранение и API до полной модели четырёх тарифов и единых feature gates end-to-end (в т.ч. согласовать БД, кэш дня и серверные маршруты). Ориентир по продукту и навигации без дублирования методики: `docs/tmp_docs/02052026/access_tiers_navigation_brief.md` (продуктовый бриф; дубликат из `docs/planning/` перенесён в `docs/05_archive/old_briefs/access_tiers_navigation_brief.md`). Методическая модель тарифов и терминология **free/premium в UI** — в справочнике ниже.

## Справочные материалы

- [Модель тарифов и терминология free/premium](../../04_reference/product/tier_model.md)
