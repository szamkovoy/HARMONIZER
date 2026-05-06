---
id: 00_index/MAP
title: Documentation Map
version: 1.1
updated: 2026-05-06
depends_on: [01_foundation/architecture, 01_foundation/product_model]
code_refs: [app/(tabs)/index.tsx, modules/astro-core/index.ts, modules/communicator/ui/Communicator.tsx]
---

## User Flow

| Модуль | Папка в docs | Точки входа в коде | Зависит от | От него зависят |
| --- | --- | --- | --- | --- |
| `profile` | `02_modules/profile/` | `app/(tabs)/profile.tsx`; `app/(tabs)/index.tsx`; `services/natalProfileClient.ts` | `astro`, `practices`, `subscription`, `infra` | `calibration`, `daily_forecast`, `assistant` |
| `calibration` | `02_modules/calibration/` | `app/calibration.tsx`; `_legacy_web/app/api/calibration/extract/route.ts`; `supabase/functions/auto-calibrate/index.ts` | `profile`, `assistant`, `infra` | `assistant` |
| `daily_forecast` | `02_modules/daily_forecast/` | `app/(tabs)/index.tsx`; `modules/home/useDayContent.ts`; `services/dailyForecastClient.ts` | `astro`, `profile`, `practices`, `subscription`, `infra` | `assistant` |
| `assistant` | `02_modules/assistant/` | `_legacy_web/app/api/communicator/v2/dialog/route.ts`; `_legacy_web/app/api/_utils/scenarios.ts`; `_legacy_web/app/api/_utils/prompts.ts`; `supabase/seed.sql` | `astro`, `calibration`, `daily_forecast`, `profile`, `practices`, `subscription`, `infra` | `calibration`, `communicator` |
| `communicator` | `02_modules/communicator/` | `modules/communicator/ui/Communicator.tsx`; `modules/communicator/ui/PracticeCard.tsx`; `services/communicator-client.ts` | `assistant`, `subscription`, `infra` | `—` |
| `practices` | `02_modules/practices/` | `modules/practices/ui/PracticeCatalogScreen.tsx`; `app/(tabs)/practices.tsx`; `app/asana-practice.tsx`; `app/breath-coherence.tsx`; `services/practiceSessions.ts` | `bindu`, `audio`, `biofeedback`, `subscription`, `infra` | `profile`, `daily_forecast`, `assistant` |

## Engines & Services

| Модуль | Папка в docs | Точки входа в коде | Зависит от | От него зависят |
| --- | --- | --- | --- | --- |
| `astro` | `02_modules/astro/` | `modules/astro-core/index.ts`; `_legacy_web/app/api/astro/daily-forecast/route.ts`; `supabase/functions/daily-forecast/index.ts` | `infra` | `profile`, `daily_forecast`, `assistant` |
| `bindu` | `02_modules/bindu/` | `modules/mandala/ui/MandalaCanvas.tsx`; `modules/mandala/ui/evolution-registry.ts`; `modules/mandala/experiments/BinduSuccessionLabCanvas.tsx`; `modules/breath/ui/BreathBinduMandala.tsx`; `app/mandala-sandbox.tsx`; `app/bindu-succession-lab.tsx`; `app/sacred-symbol-stream.tsx` | `infra`, `audio` | `practices`, `biofeedback` |
| `audio` | `02_modules/audio/` | `modules/mandala-sound/index.ts`; `modules/mandala-sound/core/engine.ts`; `modules/mandala-sound/core/sync.ts`; `modules/mandala-sound/core/timeline.ts`; `modules/mandala-sound/ui/MandalaSoundProvider.tsx` | `infra`, `biofeedback`, `practices`, `bindu` | `practices`, `bindu` |
| `biofeedback` | `02_modules/biofeedback/` | `modules/biofeedback/bus/biofeedback-pipeline.ts`; `modules/biofeedback/core/metrics.ts`; `modules/biofeedback/sensors/FingerPpgCameraSource.tsx`; `modules/breath/ui/CoherenceBreathScreen.tsx` | `infra`, `audio`, `bindu` | `bindu`, `audio`, `practices` |
| `subscription` | `02_modules/subscription/` | `modules/access/core/access.tsx`; `modules/access/core/features.ts`; `modules/access/core/tiers.ts`; `app/(tabs)/index.tsx` | `infra` | `profile`, `daily_forecast`, `assistant`, `communicator`, `practices`, `webinars`, `author_presence` |
| `infra` | `02_modules/infra/` | `_legacy_web/app/layout.tsx`; `_legacy_web/next.config.ts`; `.vercelignore`; `package.json`; `supabase/README.md` | `01_foundation/*` | `astro`, `calibration`, `profile`, `daily_forecast`, `assistant`, `communicator`, `practices`, `bindu`, `audio`, `biofeedback`, `subscription`, `webinars`, `author_presence` |
| `webinars` | `02_modules/webinars/` | `не реализовано` | `subscription`, `infra` | `—` |
| `author_presence` | `02_modules/author_presence/` | `не реализовано` | `subscription`, `infra` | `—` |

`error_tracking` документируется внутри `02_modules/infra/error_tracking.md` и не считается отдельным модулем в `MAP.md`.
