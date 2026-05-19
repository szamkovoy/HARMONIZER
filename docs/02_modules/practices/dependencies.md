---
id: 02_modules/practices/dependencies
title: Practices Dependencies
version: 1.7
updated: 2026-05-19
depends_on:
  [
    01_foundation/product_model,
    02_modules/subscription/spec,
    02_modules/biofeedback/spec,
    02_modules/audio/spec,
    02_modules/bindu/spec,
    02_modules/daily_forecast/spec,
  ]
code_refs:
  [
    modules/practices/ui/PracticeCatalogScreen.tsx,
    modules/practices/core/catalog.ts,
    app/(tabs)/practices.tsx,
    app/(tabs)/index.tsx,
    app/asana-practice.tsx,
    app/breath-coherence.tsx,
    app/sacred-symbol-stream.tsx,
    modules/mandala/experiments/SacredSymbolStreamScreen.tsx,
    modules/breath/ui/CoherenceBreathScreen.tsx,
    services/practiceSessions.ts,
  ]
---

## 1. Зависит от

- **`subscription`**  
  `app/(tabs)/_layout.tsx` — таб «Практики» с `href: null`, если нет `practice_catalog`; `modules/practices/ui/PracticeCatalogScreen.tsx`, `app/asana-practice.tsx` — `canUseFeature` / `UpgradeDialog` для каталога, асан (`asana_practices`) и связанных фич. Парная запись: `docs/02_modules/subscription/dependencies.md` §2.

- **`daily_forecast`**  
  Прямой импорт прогноза в **`modules/practices/`** отсутствует. Связь через главный экран: `app/(tabs)/index.tsx` при открытом оверлее ассистента передаёт в `Communicator` forecast-метаданные дня; серверный выбор практики (`_legacy_web/app/api/communicator/v2/dialog/practiceSelection.ts`) может учитывать контекст дня и вернуть coherent breathing на чакру дня. Парная запись: `docs/02_modules/daily_forecast/dependencies.md` §2.

- **`biofeedback`**  
  `app/breath-coherence.tsx` → **`CoherenceBreathScreen`** — PPG / pipeline и запись **`metrics`** в `practice_sessions`. Медитация **`SacredSymbolStreamScreen`** biofeedback не использует. Парная запись: `docs/02_modules/biofeedback/dependencies.md` §2.

- **`audio`**  
  `CoherenceBreathScreen` и `SacredSymbolStreamScreen` монтируют **`MandalaSoundProvider`**; план фаз (`PlannedCycle`) — из **`modules/breath/core/breath-phase-planner.ts`** (подсценарий practices). Парная запись: `docs/02_modules/audio/dependencies.md` §1.

- **`bindu`**  
  `BreathBinduMandala`, `BinduSuccessionFlowCanvas` и визуальные ветки практик. Парная запись: `docs/02_modules/bindu/dependencies.md` §2.

- **`infra`**  
  Expo Router, Supabase-клиент для каталога асан и для **`services/practiceSessions.ts`** (`practice_sessions`, `user_daily_stats`).

## 2. От него зависят

- **`audio`**  
  Дыхательный сценарий монтирует звук из practices-потока (`breath-coherence` → `CoherenceBreathScreen` → `MandalaSoundProvider`). **`PlannedCycle`** импортируется в `mandala-sound` из **`modules/breath`**. Парная запись: `docs/02_modules/audio/dependencies.md` §1 и §2.

- **`profile`**  
  `app/(tabs)/profile.tsx` при `canUseFeature("stats")` вызывает **`loadDailyPracticeStats`** из `services/practiceSessions.ts`. Парная запись: `docs/02_modules/profile/dependencies.md` §1.

- **`assistant`**  
  Серверный диалог подмешивает каталог/выбор практики (`practiceSelection.ts`, **`route.ts`** с импортом **`@shared/assistantSelectableDurations`** — `_legacy_web/shared_core/assistantSelectableDurations.ts`, копия клиентского **`assistantSelectableDurations.ts`** — для карточки, маркеры в промптах); клиентский **`Communicator`** / **`services/communicator-client.ts`** типизирует `practicePicked` и использует общий `PracticeCard` + `launchPractice`. Детализация промптов и оркестратора — в `docs/02_modules/assistant/` (модуль `assistant` заявляет зависимость на `02_modules/practices/spec` в YAML).

## 3. Контрактные точки риска

- **`practice_sessions`**: смена имён/типов колонок, `metrics` или `context` ломает профиль, ассистент и серверные запросы истории (`practiceSelection.ts` читает `practice_id` / `practice_slug` / join на `practices.kind`).

- **`FeatureKey`** (`practice_catalog`, `asana_practices`, `stats`) должна оставаться согласованной с `modules/access` и серверными проверками.

- **`PracticeLaunchParams` vs query**: несовпадение имён параметров роутов (`practiceId`, `durationMs`, `chakra`, `usePulseSensor`) ломает диплинки из каталога и из ассистента.
- **Общий `PracticeCard`**: любое сужение пропсов/типов `PracticeSummary`, `PracticeLaunchParams`, `PracticeVideoMetadata` теперь одновременно затрагивает каталог и communicator.

- **Два источника дефолта длительности медитации** (каталог vs экран) — риск UX при смешанных входах; см. `history.md`.

- **`user_practice_preferences`**: логика триггера завязана на непустой **`practice_id`**; поведение для дыхания/медитации без UUID легко забыть при изменении записи сессий.
