---
id: 02_modules/practices/dependencies
title: Practices Dependencies
version: 1.1
updated: 2026-05-07
depends_on:
  [
    01_foundation/product_model,
    02_modules/subscription/spec,
    02_modules/biofeedback/spec,
    02_modules/audio/spec,
    02_modules/bindu/spec,
    02_modules/profile/spec,
  ]
code_refs: [modules/practices/ui/PracticeCatalogScreen.tsx, app/(tabs)/practices.tsx, app/asana-practice.tsx, app/breath-coherence.tsx, services/practiceSessions.ts]
---

## 1. Зависит от (фрагмент, парная связь с `profile`)

- **`profile`**  
  `app/(tabs)/profile.tsx` при `canUseFeature("stats")` вызывает `loadDailyPracticeStats(authUser.id, 14)` из `services/practiceSessions.ts` — чтение агрегатов завершённых практик для графика. Парная запись: `docs/02_modules/profile/dependencies.md` §2.

## TODO: наполнить на этапе миграции.

Здесь будут связи practices с `subscription`, `assistant`, `biofeedback`, `audio`, `bindu` и persistence слоем.
Отдельно будут отмечены launch points и feature gates.
