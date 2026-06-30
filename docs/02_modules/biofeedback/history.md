---
id: 02_modules/biofeedback/history
title: Biofeedback History
version: 1.7
updated: 2026-07-01
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

- **2026-07-01 (2):** Polar off-body follow-up — `wearableRrQuality.ts` rejects BLE RR packets whose minimum interval drops below 400 ms. `BleHeartRateSource` skips ingesting those beats and stops refreshing `lastRrAtMs`, allowing `signalLost`, measured-pulse zeroing, and suppression of garbage RSA cycles during strap-off periods.

- **2026-07-01:** Polar/fullMetrics BLE off-body detection no longer trusts HR-only packets after RR goes stale: `BleHeartRateSource` emits `signalLost` when `lastRrAtMs` exceeds ~3.5 s, and breath `pulseLog` now records `liveMeasurementActive` / `interpolationHoldActive` so exports explain measured vs guidance vs synthetic segments without guesswork.

- **2026-06-30 (6):** BLE runtime now honors the Heart Rate Measurement `sensorContactDetected` flag instead of treating every incoming packet as valid body contact. If a chest strap keeps broadcasting off-body, `BleHeartRateSource` now reports `signalLost` rather than `ready`, so downstream practice graphs can drop measured pulse to zero and enter synthetic guidance only after a real contact loss instead of pretending that stale RR still means trustworthy biometrics.

- **2026-06-30 (5):** Source switches between camera CMTime and wall-clock synthetic beats now reset the pipeline's time-based throttles instead of inheriting incompatible timestamps. Without this, a camera session that briefly entered `emulated` could recover real beats correctly but stop publishing `pulseBpm`/derived chart points forever after the switch back.

- **2026-06-30 (4):** Breath `pulseLog` became explicitly dual-track. Runtime/export entries now distinguish `measuredPulseRateBpm` from `guidancePulseRateBpm`, so field analysis can tell the difference between a sensor that truly stopped measuring and a practice that intentionally kept breathing guidance alive on fallback/emulated BPM. The results modal uses the same split to render separate measured/guidance pulse charts when they diverge.

- **2026-06-30 (3):** Breath export gained a last-resort pulse-log fallback from the already rendered results graph. If the live `pulseLog` has been cleared by the time the user exports JSON, `CoherenceBreathScreen` now serializes the decimated pulse series that was actually shown on the results screen instead of emitting an empty array and losing the main diagnostic trace.

- **2026-06-30 (2):** BLE full-session HRV accumulation was repaired after field exports exposed a hidden tail-freeze. `BiofeedbackPipeline.pushBeatEvent(...)` no longer reuses the optical reanalysis merge for committed wearable beats, and `HrvBeatAccumulator` now remembers the resume-beat after a `>2 s` gap so RMSSD/stress continue accumulating after the hole instead of freezing near the first long detach. The same pass also formalized lightweight runtime series capture for post-practice charts (pulse, RMSSD, stress, RSA).

- **2026-06-29 (5):** BLE reconnect/runtime branch was flattened around explicit `ready` semantics: `guidedOnly` and `fullMetrics` now both surface as ready-states after capability resolution, monitor-characteristic failures go back through the same reconnect path, and `waitingForBluetooth` can auto-resume once the adapter turns on. `CoherenceBreathScreen` also gained a two-way emulated fallback: after sustained live-signal loss it can switch to seeded synthetic pulse, keep watching the original source, and automatically return to live camera/BLE pulse once recovery is confirmed.

- **2026-06-29 (6):** BLE HRV accumulation no longer re-arms calibration on every incoming RR/HR packet. A regression in the reconnect cleanup briefly caused the wearable path to clear `HrvBeatAccumulator` repeatedly, which left coherent BLE sessions with valid coherence/RSA but blank `RMSSD` / stress on the result screen and in debug export. Calibration for beat-sources is now initialized once per live wearable session instead of once per packet.

- **2026-06-29 (7):** Breath debug export no longer blindly serializes the raw cached result from `CoherenceEngine` when the screen already replaced it with a gated/suppressed `analysis`. This matters especially for camera guidance-only mode: JSON export now reflects the same final result state the user saw on screen instead of leaking legacy coherence warnings/fields from the engine cache.

- **2026-06-29 (8):** `pulseLog` in breath export was extended with explicit runtime context (`pulseSource`, `emulatedActive`, wearable runtime state and capability tier). This makes field analysis of signal-loss scenarios possible without reverse-engineering fallback transitions from RR gaps alone, especially on BLE sessions where raw analyzed beats can contain only edge gaps around `live <-> emulated` handoffs.

- **2026-06-29 (9):** Breath runtime/export diagnostics were tightened again around real beat loss. Camera guidance-only startup now reapplies `metricsCapturePaused` after each screen reset so the heavy HRV/coherence branch stays truly off for `fingerCamera`, long-loss fallback keys off the age of the last fresh beat instead of the current contact snapshot alone, and debug export gained `pulseLog.lastBeatTimestampMs/lastBeatAgeMs` plus per-session `runtimeEvents` (AppState / keep-awake / fallback lifecycle).

- **2026-06-30:** BLE breath diagnostics showed that lock/sleep could still falsely trip the shared background-resume guard: `CoherenceBreathScreen` was reusing camera `fingerDetected` semantics even in wearable mode. The resume path now skips that camera-only auto-abort for BLE and logs wearable-specific resume context instead; debug `pulseLog` also gained wearable HR/RR freshness fields so future exports can distinguish “strap kept sending coherent RR” from real reconnect/fallback events.

- **2026-06-29 (4):** Breath production-flow now treats `fingerCamera` as a guidance-only source. `CoherenceBreathScreen` keeps camera pulse/BPM for live pacing, pauses the heavy HRV/coherence/RSA branch (`metricsCapturePaused`), stops feeding live RSA planning/results from camera sessions, and on long camera-signal loss switches the practice to emulated pulse seeded from the last stable BPM instead of hard auto-abort. Advanced metrics remain available for BLE RR devices and for parity/debug tooling.

- **2026-06-29 (3):** BLE runtime now treats silent connected straps as `signalLost` after a packet stall, auto-reconnects, and parity bench keeps finger capture during in-app navigation (`persistCaptureWhenBlurred`). Finger camera remounts on capture resume to avoid frozen PPG after blur. `useRememberedWearableProbe` lets practice cards hide stale saved chest straps until a short scan sees them advertising; wearable picker not-found state now includes troubleshooting tips.

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
