---
id: 02_modules/biofeedback/history
title: Biofeedback History
version: 1.6
updated: 2026-06-29
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

- **2026-06-29:** Finger trust grace-window semantics refined: the first minute is not blindly discarded — evaluation starts at session start when grace had no gaps, after the last early recovery when gaps occurred, or from minute two when failures never settled. Parity bench coherence/RSA now use `runCoherenceSessionAnalysis` on trimmed `metricBeats` (same series as RMSSD/stress); finger pipeline appends full HRV beats to `CoherenceEngine` each sample. Hybrid breath start/end windows now also pass `applyInitialGraceWindow: true`.

- **2026-06-29 (2):** `BiofeedbackParityScreen` debug coherence no longer starts from `Date.now()` before the source has emitted its own timestamp. The screen now waits for the first real sensor timestamp, which fixes camera-path `coherence/RSA` staying blank while BLE worked, and parity UI also shows `—` instead of `0` when the post-trim wearable window still has too few beats for HRV display.

- **2026-06-28 (12):** `BiofeedbackParityScreen` no longer stops at `RMSSD` / stress. Each source panel now starts its own debug coherence test-session (`5s + 5s`, `test120s`) and surfaces live `coherence` average plus `RSA`, but only while `SignalTrustLevel` remains `full_biometrics`; degraded finger trust still withholds these fields instead of showing misleading parity numbers.

- **2026-06-28 (8):** Finger metric smoothing was strengthened after reprocessing parity exports against synchronized tail windows. `smoothBeatTimestampsMedian3ForMetrics(...)` now runs two conservative median-of-3 RR passes instead of one: this keeps the respiratory envelope intact, but removes enough residual `short/long` camera jitter for RMSSD / stress to get much closer to Polar on clean and short-gap tails.

- **2026-06-28 (9):** `SignalTrustLevel` stopped being segment-local. The pipeline now preserves finger gap events across repeated `lost -> warmup -> ready` recoveries and also records whole-session loss spans, so long or repeated finger detachments no longer look like a fresh `full_biometrics` session just because the latest recovered chunk is internally clean.

- **2026-06-28 (10):** Late-session degradation no longer has to zero-out HRV entirely. When a finger session ends in `pulse_only`, `BiofeedbackPipeline` now looks for the latest reliable tail window (prefer 180 s, then 120 s, then 90 s) and, if found, preserves `RMSSD` / `stress` from that clean tail as approximate values. Coherence/RSA stay withheld in this mode.

- **2026-06-28 (11):** Coherence/RSA получили собственный tail-fallback, более строгий, чем HRV. `CoherenceBreathScreen` теперь пытается восстановить coherence/RSA только по непрерывному окну 180/150/120 с без локальных gap-событий и только если сам `runCoherenceSessionAnalysis(...)` по этому окну не уходит в `metricsWithheldDueToInsufficientData`. Дополнительное finger median-smoothing в этот путь намеренно не пущено: coherence/RSA остаются на raw session beats + `cleanRrSequenceCoherence(...)`.

- **2026-06-28 (7):** Finger-camera sessions gained an explicit `SignalTrustLevel` (`full_biometrics` / `guided_limited` / `pulse_only`) derived from gap counters (`gapEventCount`, `totalGapMs`, `longestGapMs`) plus post-filter jitter on `metricBeats`. `CoherenceBreathScreen` now uses the same trust summary to gate final metrics: `guided_limited` keeps pulse guidance and RMSSD/stress but hides coherence/RSA, while `pulse_only` hides final biometrics entirely and lets the planner fall back to baseline BPM without fresh RSA cycles.

- **2026-06-28 (4):** Finger-camera path gained two conservative pre-metric corrections before downstream metrics. After merge + split-artifact collapse, `BiofeedbackPipeline` now runs `repairMissedMergedBeats(...)` for obvious dropped optical peaks (one long RR that matches `2-3` local normal RR intervals) and `stabilizeAlternatingJitterBeats(...)` for alternating `short/long` timing jitter where the pair-average still matches the local rhythm. Together these passes reduce RMSSD / stress inflation from PPG timing noise without flattening the slow breathing envelope into a straight line.

- **2026-06-28 (5):** `BiofeedbackParityScreen` stopped comparing raw wearable metrics from second zero against finger metrics that only start after camera `ready`. The debug bench now trims the first `warmup + settle` window (20 s) from the chest-strap side before displaying parity `RMSSD` / stress, so differences in the panel reflect RR quality more than startup asymmetry.

- **2026-06-28 (6):** Finger metric calculation gained a dedicated `smoothBeatTimestampsMedian3ForMetrics(...)` pass after `HrvBeatAccumulator`: for `fingerCamera` only, RR is median-smoothed over local triples and reconstructed back into beat timestamps before `RMSSD` / Baevsky stress are computed. The parity bench was wired to the same metric beat-series, so its RR/BPM charts and exported `metricBeats` now reflect the row that actually feeds debug metric comparison.

- **2026-06-28 (3):** Polar RR timeline reconstruction stopped re-anchoring every BLE notify to `Date.now()`. `wearableBeatTimeline.ts` now chooses the suffix of RR intervals that is actually new relative to the last committed beat, which removes the recurring `~800/250/750/220 ms` sawtooth seen on Polar H10 field exports and keeps full-session HRV from collapsing to near-zero RMSSD. The same pass also added a dedicated debug route `app/biofeedback-parity.tsx` / `BiofeedbackParityScreen` with two isolated pipelines (finger camera + BLE strap) and stacked live `BPM` / `RR` charts for visual parity testing.

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
