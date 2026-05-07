---
id: 02_modules/practices/dependencies
title: Practices Dependencies
version: 1.3
updated: 2026-05-07
depends_on:
  [
    01_foundation/product_model,
    02_modules/subscription/spec,
    02_modules/biofeedback/spec,
    02_modules/audio/spec,
    02_modules/bindu/spec,
    02_modules/daily_forecast/spec,
  ]
code_refs: [modules/practices/ui/PracticeCatalogScreen.tsx, app/(tabs)/practices.tsx, app/asana-practice.tsx, app/breath-coherence.tsx, services/practiceSessions.ts]
---

## 1. Зависит от

- **`subscription`**  
  `app/(tabs)/_layout.tsx` — таб «Практики» с `href: null`, если нет `practice_catalog`; `modules/practices/ui/PracticeCatalogScreen.tsx`, `app/asana-practice.tsx` — `canUseFeature` / `UpgradeDialog` для каталога, асан и связанных фич. Парная запись: `docs/02_modules/subscription/dependencies.md` §2.

- **`daily_forecast` (контекст дня на главном экране)**  
  `app/(tabs)/index.tsx` — `launchPractice` и карта `planetChakra` от `forecast.planetOfTheDay` через `useDayContent`. Парная запись: `docs/02_modules/daily_forecast/dependencies.md` §2.

- **`biofeedback`**  
  `app/breath-coherence.tsx` → `CoherenceBreathScreen` — полный PPG/pipeline. Парная запись: `docs/02_modules/biofeedback/dependencies.md` §2.

- **`audio`**  
  `CoherenceBreathScreen` монтирует `MandalaSoundProvider`; план фаз (`PlannedCycle`) — из **`modules/breath/core/breath-phase-planner.ts`** как часть дыхательного подсценария **practices** (см. `docs/02_modules/audio/dependencies.md` §1).

- **`bindu`**  
  `BreathBinduMandala` и визуальные ветки практик используют mandala/bindu-контур. Парная запись: `docs/02_modules/bindu/dependencies.md` §2.

- **`infra`**  
  Expo/React Native, навигация на экраны практик, Supabase для `practice_sessions` через `practiceSessions.ts`.

## 2. От него зависят

- **`audio`**  
  В графе документации **`audio` зависит от `practices`**: дыхательный сценарий монтирует звук (`app/breath-coherence.tsx` → `CoherenceBreathScreen` → `MandalaSoundProvider`). В репозитории **`PlannedCycle`** подтягивается в `mandala-sound` **импортом из `modules/breath/core/breath-phase-planner.ts`** — это внутренняя реализация подсценария practices, не отдельный модуль в `MAP.md`. Парная запись: `docs/02_modules/audio/dependencies.md` §1 и §2.

- **`profile`**  
  `app/(tabs)/profile.tsx` при `canUseFeature("stats")` вызывает `loadDailyPracticeStats` из `services/practiceSessions.ts`. Парная запись: `docs/02_modules/profile/dependencies.md` §1.

- **`assistant` (сервер / промпты)**  
  Контекст практик и каталога подмешивается в сценарии ответчика (`MAP.md`, модуль `assistant`). Детальный контракт — при миграции `assistant` по `docs/03_rules/migration_protocol.md`.

## 3. Контрактные точки риска

- **`practice_sessions` и схема записи** — смена колонок или правил записи ломает статистику профиля и отчёты без миграции.
- **Согласованность `FeatureKey` с `subscription`** — новый gate в каталоге требует строки в `TIER_FEATURES` и обхода UI-табов.

Полный обзор связей с `assistant`, отчётами и остальными потребителями — при отдельной миграции модуля `practices` по `docs/03_rules/migration_protocol.md`.
