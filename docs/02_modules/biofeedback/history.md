---
id: 02_modules/biofeedback/history
title: Biofeedback History
version: 1.1
updated: 2026-05-07
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

- **2026-05:** Архитектура «сенсор → signal/quality → отдельные engines → `BiofeedbackBus` → React» зафиксирована в коде и ранее описана в перенесённом `docs/05_archive/migrated/biofeedback/biofeedback-architecture.md`; канон остаётся в репозитории модулей, не в корневых `docs/*.md`.

- **2026-05:** Когерентность и RSA для **финального отчёта** считаются в `modules/breath/core/coherence-session-analysis.ts`; `CoherenceEngine` / `RsaEngine` не дублируют формулы, чтобы сохранить parity между live-циклами и экспортом.

- **2026-05:** Итоговые RMSSD и индекс Баевского для практики дыхания переведены на **`computePracticeHrvMetricsFullSession`** (один проход по всей серии валидных ударов). Старый сегментный вариант `computePracticeHrvMetrics` оставлен для совместимости/тестов — см. комментарии в `core/metrics.ts`.

- **2026-05:** Функция **`updateHrvMetrics`** в `metrics.ts` не подключена к `FingerSignalAnalyzer` / `BiofeedbackPipeline`; live-метрики идут через `HrvEngine`/`StressEngine` с отдельным троттлингом. Это расхождение с идеей «единой точки updateHrvMetrics для камеры», если такая фигурировала в старых текстах.

- **2026-05:** Троттлинг пикового детектора, BPM, HRV/stress и публикаций `session`/`contact`/`optical` внесён в `BiofeedbackPipeline` для снижения CPU/GC на длинных сессиях (комментарии в коде с обоснованием частот).
