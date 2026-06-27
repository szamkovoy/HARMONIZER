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

- **2026-06-27:** Added the first BLE chest-strap path without forking downstream metrics. New `modules/biofeedback/wearables/*` handles scan / connect / Heart Rate Service parsing (`180D` / `2A37`), pipes RR into `BiofeedbackPipeline.pushBeatEvent(...)`, and pauses metrics automatically for `guidedOnly` heart-rate-only devices. Trusted Polar profiles (`H10`, `H9`) get a separate `polarEnhanced` capability hint, but still feed the same canonical pipeline/coherence/export path as camera PPG.

- **2026-06-24:** Immersive breath/mandala chrome started moving into shared UI ownership without touching the sensing engines. Close controls, overlay auto-hide and stop-confirm dialog now have shared primitives in `modules/ui/`; `CoherenceBreathScreen` already consumes the shared stop-confirm/close path, while domain logic (PPG pipeline, coherence FSM, export/metrics) stays fully inside `breath`/`biofeedback`.

- **2026-05:** Архитектура «сенсор → signal/quality → отдельные engines → `BiofeedbackBus` → React» зафиксирована в коде и ранее описана в перенесённом `docs/05_archive/migrated/biofeedback/biofeedback-architecture.md`; канон остаётся в репозитории модулей, не в корневых `docs/*.md`.

- **2026-05:** Когерентность и RSA для **финального отчёта** считаются в `modules/breath/core/coherence-session-analysis.ts`; `CoherenceEngine` / `RsaEngine` не дублируют формулы, чтобы сохранить parity между live-циклами и экспортом.

- **2026-05:** Итоговые RMSSD и индекс Баевского для практики дыхания переведены на **`computePracticeHrvMetricsFullSession`** (один проход по всей серии валидных ударов). Старый сегментный вариант `computePracticeHrvMetrics` оставлен для совместимости/тестов — см. комментарии в `core/metrics.ts`.

- **2026-05:** Функция **`updateHrvMetrics`** в `metrics.ts` не подключена к `FingerSignalAnalyzer` / `BiofeedbackPipeline`; live-метрики идут через `HrvEngine`/`StressEngine` с отдельным троттлингом. Это расхождение с идеей «единой точки updateHrvMetrics для камеры», если такая фигурировала в старых текстах.

- **2026-05:** Троттлинг пикового детектора, BPM, HRV/stress и публикаций `session`/`contact`/`optical` внесён в `BiofeedbackPipeline` для снижения CPU/GC на длинных сессиях (комментарии в коде с обоснованием частот).
