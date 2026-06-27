---
id: 02_modules/biofeedback/history
title: Biofeedback History
version: 1.3
updated: 2026-06-27
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/audio/spec, 02_modules/bindu/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/biofeedback/bus/biofeedback-pipeline.ts,
    modules/biofeedback/engines/coherence-engine.ts,
    modules/biofeedback/core/metrics.ts,
    docs/05_archive/migrated/biofeedback/biofeedback-architecture.md,
  ]
---

## Decision Log

- **2026-06-28 (2):** Polar multi-RR BLE packets — `wearableBeatTimeline.ts` now commits only beat timestamps strictly after the last merged beat, so streaming notifies no longer re-insert historical RR and trigger coherence withhold (`rrBadFraction` ≥ 20%) on an otherwise full 5-minute strap session.

- **2026-06-28:** Polar H10 metrics follow-up — RR packets now map to beat timestamps via HRS-correct backward reconstruction (`wearableBeatTimeline.ts`), and wearable sessions bypass `PulseBpmEngine` PPG filtering when feeding `CoherenceEngine`/`HrvBeatAccumulator`. Finger-camera filtering and merge path stay unchanged.

- **2026-06-27 (4):** BLE QA follow-up after Polar H10 field tests. `BleHeartRateSource` now resets its RR beat timeline only after a real gap between BLE packets (`lastRrAtMs`), fixing spurious 5–10 s RR jumps that left coherence/HRV metrics withheld despite live BPM in the footer. `useWearableScanner` scans Heart Rate Service with `allowDuplicates: true`, merges partial advertisements into one candidate, and `WearablePickerDialog` waits the full **12 s** window from the moment scanning actually starts before showing «не найден».

- **2026-06-27 (3):** BLE runtime loop and UX were hardened after real-device QA. `BleHeartRateSource` stopped restarting its effect on every parent re-render by decoupling event callbacks from effect deps, and the shared `WearablePickerDialog` became the single BLE chooser for both the catalog card and runtime recovery inside `CoherenceBreathScreen`.

- **2026-06-27 (2):** BLE scan start on iOS was hardened after QA hit a dev-client crash when entering the Bluetooth strap path. `useWearableScanner` now restarts scans defensively and calls `startDeviceScan([], {}, ...)` instead of passing nulls into the native layer; the shared `BleManager` also stopped opting into restoration identifiers because this flow does not use background BLE restoration.

- **2026-06-27:** Added the first BLE chest-strap path without forking downstream metrics. New `modules/biofeedback/wearables/*` handles scan / connect / Heart Rate Service parsing (`180D` / `2A37`), pipes RR into `BiofeedbackPipeline.pushBeatEvent(...)`, and pauses metrics automatically for `guidedOnly` heart-rate-only devices. Trusted Polar profiles (`H10`, `H9`) get a separate `polarEnhanced` capability hint, but still feed the same canonical pipeline/coherence/export path as camera PPG.

- **2026-06-24:** Immersive breath/mandala chrome started moving into shared UI ownership without touching the sensing engines. Close controls, overlay auto-hide and stop-confirm dialog now have shared primitives in `modules/ui/`; `CoherenceBreathScreen` already consumes the shared stop-confirm/close path, while domain logic (PPG pipeline, coherence FSM, export/metrics) stays fully inside `breath`/`biofeedback`.

- **2026-05:** Архитектура «сенсор → signal/quality → отдельные engines → `BiofeedbackBus` → React» зафиксирована в коде и ранее описана в перенесённом `docs/05_archive/migrated/biofeedback/biofeedback-architecture.md`; канон остаётся в репозитории модулей, не в корневых `docs/*.md`.

- **2026-05:** Когерентность и RSA для **финального отчёта** считаются в `modules/breath/core/coherence-session-analysis.ts`; `CoherenceEngine` / `RsaEngine` не дублируют формулы, чтобы сохранить parity между live-циклами и экспортом.

- **2026-05:** Итоговые RMSSD и индекс Баевского для практики дыхания переведены на **`computePracticeHrvMetricsFullSession`** (один проход по всей серии валидных ударов). Старый сегментный вариант `computePracticeHrvMetrics` оставлен для совместимости/тестов — см. комментарии в `core/metrics.ts`.

- **2026-05:** Функция **`updateHrvMetrics`** в `metrics.ts` не подключена к `FingerSignalAnalyzer` / `BiofeedbackPipeline`; live-метрики идут через `HrvEngine`/`StressEngine` с отдельным троттлингом. Это расхождение с идеей «единой точки updateHrvMetrics для камеры», если такая фигурировала в старых текстах.

- **2026-05:** Троттлинг пикового детектора, BPM, HRV/stress и публикаций `session`/`contact`/`optical` внесён в `BiofeedbackPipeline` для снижения CPU/GC на длинных сессиях (комментарии в коде с обоснованием частот).
