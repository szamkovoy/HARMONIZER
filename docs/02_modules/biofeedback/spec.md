---
id: 02_modules/biofeedback/spec
title: Biofeedback Spec
version: 1.7
updated: 2026-06-30
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/audio/spec, 02_modules/bindu/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/biofeedback/bus/biofeedback-pipeline.ts,
    modules/biofeedback/bus/biofeedback-bus.ts,
    modules/biofeedback/bus/biofeedback-provider.tsx,
    modules/biofeedback/bus/channels.ts,
    modules/biofeedback/bus/react.tsx,
    modules/biofeedback/bus/snapshot-adapter.ts,
    modules/biofeedback/sensors/FingerPpgCameraSource.tsx,
    modules/biofeedback/sensors/EmulatedPulseSensorSource.tsx,
    modules/biofeedback/sensors/SimulatedSensorSource.tsx,
    modules/biofeedback/wearables/BleHeartRateSource.tsx,
    modules/biofeedback/wearables/WearablePickerDialog.tsx,
    modules/biofeedback/wearables/useWearableScanner.ts,
    modules/biofeedback/wearables/heartRateMeasurement.ts,
    modules/biofeedback/wearables/preferences.ts,
    modules/biofeedback/wearables/trustedProfiles.ts,
    modules/biofeedback/core/metrics.ts,
    modules/biofeedback/adapters/MandalaBioFrameAdapter.ts,
    modules/biofeedback/export/SessionExporter.ts,
    modules/biofeedback/ui/BiofeedbackParityScreen.tsx,
    modules/biofeedback/i18n/debug.ts,
    modules/breath/ui/CoherenceBreathScreen.tsx,
    app/biofeedback-parity.tsx,
    modules/mandala-sound/ui/MandalaSoundProvider.tsx,
    modules/mandala-sound/core/sync.ts,
  ]
---

## 1. Назначение

`biofeedback` — клиентский конвейер пульсового сигнала: **PPG с камеры** (палец на вспышку) или **BLE chest strap** (Heart Rate Service `180D` / `2A37`), извлечение ритма ударов, оценка качества сигнала и публикация метрик в типизированную шину **`BiofeedbackBus`**. Модуль обслуживает дыхательные практики с обратной связью (прежде всего когерентное дыхание), визуализацию мандалы и звуковую модуляцию через подписчиков; тяжёлая математика когерентности/RSA для **итога сессии** живёт в `modules/breath/core/coherence-session-analysis.ts` и вызывается из `CoherenceEngine` при `finalize`, чтобы не дублировать формулы.

## 2. Публичный контракт

**Вход (сенсор):** либо поток `RawOpticalSample` с камеры (`timestampMs`, усреднённый канал яркости и др.) — см. `modules/biofeedback/sensors/types.ts`, либо готовые beat/RR события от BLE chest strap через `modules/biofeedback/wearables/BleHeartRateSource.tsx`. Источники: `FingerPpgCameraSource` (Expo `Camera` + torch), `EmulatedPulseSensorSource`, `SimulatedSensorSource`, `BleHeartRateSource`; опционально нативный модуль `modules/biofeedback-finger-frame-processor` для ускоренной обработки кадра, если доступен.

**Ядро:** `BiofeedbackPipeline.pushOpticalSample(sample)` остаётся входом для камеры, а `pushBeatEvent(timestampMs, beatTimestampMs)` — каноническим входом для wearable RR / synthetic beats. На выходе в шину публикуются события по каналам из `channels.ts`:

| Канал | Назначение (кратко) |
| --- | --- |
| `optical` | сырой/обработанный оптический ряд (диагностика, мини-график) |
| `contact` | присутствие пальца, уверенность |
| `session` | фазы `CalibrationStateMachine` (warmup / settle / ready / lost) |
| `beat` | удар: `BeatEvent` (`timestampMs`, `source`: `detected` \| `extrapolated`, `confidence`) |
| `pulseBpm` | скользящий BPM |
| `rmssd` | RMSSD (мс), сегмент, тир, approximate-флаги |
| `stress` | индекс стресса (проценты + сырое) |
| `coherence` | снимок когерентности (в т.ч. `currentPercent`, `entryTimeSec`, агрегаты сессии) |
| `rsa` | снимок RSA после разбора сессии |
| `pulseSource` | реальный датчик vs эмуляция |
| `error` | ошибки движка/сенсора |

**React:** `BiofeedbackBusProvider`, `useBiofeedbackBus`, `useBiofeedbackChannel`, `useBiofeedbackSubscribe`, `useBiofeedbackPipeline`, `useBiofeedbackSnapshot` — см. `bus/react.tsx`, `bus/biofeedback-provider.tsx`, `bus/snapshot-adapter.ts`.

**Wearables (barrel `modules/biofeedback/wearables/`):** `useWearableScanner`, `BleHeartRateSource`, общий модальный **`WearablePickerDialog`** (строки через prop `strings`, колбэки `onSelect` / `onClose`), preferences/trusted profiles — реэкспорт из `wearables/index.ts`.

**Агрегация для мандалы:** `MandalaBioFrameAdapter` — подписка на `beat`, `pulseBpm`, `rmssd`, `stress`, `coherence`, `contact`; метод `snapshot()` возвращает `BioSignalFrame` (`modules/mandala/core/types.ts`) с нормализованными полями для шейдера.

**Итог сессии (HRV):** `computePracticeHrvMetricsFullSession` в `core/metrics.ts` — RMSSD и индекс Баевского по **полной** серии валидных ударов после практики (см. комментарий в коде про отказ от раздельных initial/final для дыхания). Для `fingerCamera` итоговый ряд перед HRV считается не по raw `hrvValidBeats`, а по `metricBeats`: `BiofeedbackPipeline` делает finger-only median smoothing по RR (`smoothBeatTimestampsMedian3ForMetrics(...)`) и отдаёт этот же ряд в breath-finalize и в экспорт `SessionExporter`. С июня 2026 это уже не одиночный проход, а два подряд идущих median-of-3 pass'а по RR: один проход снимал только часть `short/long` PPG-jitter, а второй существенно лучше сводит tail-window parity с Polar H10 без moving-average flattening дыхательной волны. Однако production-flow дыхательной практики больше **не** публикует эти advanced HRV/coherence/RSA метрики для `fingerCamera`: камера там используется только для pulse guidance, а `metricsCapturePaused` держит тяжёлую ветку выключенной и теперь повторно выставляется после каждого screen-level reset/start, чтобы guidance-only режим не “отлипал” назад в full metrics. Функция `updateHrvMetrics` в том же файле **не используется** текущим PPG-пайплайном (помечена для альтернативных источников RR). BLE-capability tiers: `fullMetrics` — RR пришёл и downstream-метрики считаются как обычно; `guidedOnly` — есть только heart-rate pacing, pipeline ставит `metricsCapturePaused`; `unsupported` — UI не должен запускать метрики/биометрию.

## 3. Внутренняя архитектура

- **Слои:** сенсор → `OpticalRingBuffer` / bandpass → `ContactMonitor` → `SignalQualityMonitor` → `CalibrationStateMachine` → `LivePulseChannel` + merge пиков → `PulseBpmEngine`, `HrvBeatAccumulator` + `HrvEngine`, `StressEngine`, `CoherenceEngine`, `RsaEngine` — см. заголовок класса `BiofeedbackPipeline`.
- **Wearable path:** `useWearableScanner` ищет BLE-устройства по Heart Rate Service / имени, `BleHeartRateSource` подключается через `@sfourdrinier/react-native-ble-plx`, парсит characteristic `0x2A37`, конвертирует RR (`1/1024 s`) в beat timestamps и отдаёт их в тот же pipeline. Первый BLE-пакет по-прежнему раскладывается назад от времени notify, но когда последний committed beat уже известен, `wearableBeatTimeline.ts` выбирает **суффикс реально новых RR** относительно этого beat, а не анкерит каждый notify к `Date.now()`; это убирает transport-lag sawtooth `800/250/750/220 ms`, который особенно заметен на Polar multi-RR packets. Для `pulseSource=wearable` `BiofeedbackPipeline.pushBeatEvent` не подменяет `canonicalBeats` PPG-фильтром `PulseBpmEngine` — chest strap идёт в coherence/HRV из merged-ленты. Сам wearable merge-path теперь append'ит committed beats без повторного optical-style reanalysis, а `HrvBeatAccumulator` запоминает resume-beat после gap `> 2 s`; поэтому длинная BLE-сессия больше не должна “схлопываться” до одного текущего beat или терять весь HRV-хвост после первой крупной дыры. BLE runtime считает оба разрешённых capability tier (`guidedOnly`, `fullMetrics`) состоянием `ready`, но если пакет `0x2A37` явно выставляет `sensorContactDetected = false`, runtime больше не притворяется `ready`: off-body packets теперь помечаются как `signalLost` и не проходят дальше как «живая» RR-биометрия. `probing` живёт только до фактического разрешения возможностей. При emulated-fallback экран практики может оставить BLE-соединение живым, но временно включить `suppressBeatEvents`: runtime продолжает следить за packet/RR recovery и reconnect, не смешивая real BLE beats с синтетическим пульсом. Общий `WearablePickerDialog` (окно **12 с**) переиспользуется в `PracticeCard` и runtime recovery в `CoherenceBreathScreen`. Для trusted Polar-профилей (`Polar H10`, `Polar H9`) UI помечает источник как `polarEnhanced`, но downstream-метрики остаются общими.
- **Потоки и троттлинг:** пиковый детектор и публикации BPM/HRV/stress/coherence намеренно **редуцируются по времени** (см. константы в `BiofeedbackPipeline`) ради CPU и батареи на длинных сессиях.
- **RR filtering policy:** `PulseBpmEngine` различает `fingerCamera` и `wearable` для **live BPM display** (окно RR `300..2000 ms`, ослабленный deviation). Coherence/HRV для BLE берут merged beats напрямую; finger-camera path после обычного merge и split-artifact collapse делает ещё два консервативных pass'а перед downstream-метриками: `repairMissedMergedBeats(...)` вставляет `1-2` synthetic beat timestamps, если один длинный RR убедительно выглядит как `2-3` соседних локально-нормальных RR, а `stabilizeAlternatingJitterBeats(...)` слегка двигает внутреннюю beat-метку в парах `короткий/длинный` или `длинный/короткий`, если их средний период совпадает с локальным ритмом. После накопления валидных beats finger-only метрический путь (`RMSSD` / `stress`) делает ещё один шаг `smoothBeatTimestampsMedian3ForMetrics(...)`: RR-ряд сглаживается median-of-3, затем из него заново собираются beat timestamps для расчёта метрик. Это убирает локальный `short/long/short` PPG-jitter без грубого flattening дыхательной волны. Обычная дыхательная вариабельность и единичные длинные RR без кратного совпадения не интерполируются и не выравниваются.
- **Signal trust gates:** поверх finger-only коррекций pipeline теперь считает явный `SignalTrustLevel` по четырём признакам: `gapEventCount`, `totalGapMs`, `longestGapMs`, и post-filter jitter (`meanAbsDrrMetricMs`, `p90AbsDrrMetricMs`) из `metricBeats`. Уровни: `full_biometrics` — допускает live/final coherence + RSA + HRV; `guided_limited` — сохраняет pulse/BPM и финальные RMSSD/stress, но coherence/RSA больше не публикуются как доверенные; `pulse_only` — оставляет только pulse-guidance и скрывает финальную биометрию. Важно: trust теперь считается по **сессии**, а не только по последнему recovered-сегменту. `BiofeedbackPipeline` копит finger gap-events и повторные `lost → ready` провалы отдельно от текущего `HrvBeatAccumulator`, поэтому краткие/длинные отрывы пальца больше не «забываются» после нового warmup. Дополнительно для session-level trust появился стартовый grace-window: первую минуту **не отбрасывают** — если в ней не было gap-событий, trust считается с начала окна; если были сбои, валидная оценка начинается после **последнего** recovery в grace-окне; если сбои не прекратились до конца минуты (последний recovery в пределах 5 с от её конца), оценка начинается с **60-й секунды**, и дальше действуют обычные gap-гейты. Grace применяется только когда после grace остаётся ещё ≥60 с и ≥30 metric beats. `applyInitialGraceWindow: true` используется для whole-session trust и для каждого hybrid-окна (старт/финал практики) в `CoherenceBreathScreen`.
- **Late-session HRV fallback:** если итоговая finger-сессия в целом уходит в `pulse_only`, но у неё есть достаточно длинный чистый хвост в конце измерения, pipeline может восстановить только HRV-метрики (`RMSSD` / `stress`) по последнему надёжному окну вместо полного `—`. Текущий консервативный критерий: искать tail-window не короче **90 секунд** (предпочтительно 180 → 120 → 90 с) и брать его только если локальный trust этого окна лучше, чем `pulse_only`. Coherence/RSA таким fallback-ом **не** восстанавливаются: для них продукт по-прежнему требует `full_biometrics`.
- **Late-session coherence fallback:** для `coherence/RSA` введён отдельный и более строгий tail-fallback. Если итоговая finger-сессия в целом уже не проходит `full_biometrics`, `CoherenceBreathScreen` может попробовать восстановить coherence/RSA не по всей сессии, а по последнему непрерывному tail-окну **180 / 150 / 120 секунд**. Критерии: локальный finger-trust в этом окне не должен быть `pulse_only`, окно не должно содержать собственных gap-событий (`gapEventCount = 0`, `longestGapMs <= 2s`), а сам `runCoherenceSessionAnalysis` по этому окну должен пройти свои внутренние гейты (`metricsWithheldDueToInsufficientData = false`, достаточно валидных секунд тахограммы, ненулевая coherence/RSA). Finger-only median-smoothed ряд в этот fallback **не** подаётся: coherence/RSA используют исходные session beats + штатную `cleanRrSequenceCoherence(...)`, чтобы не сплющить дыхательную волну и время вхождения дополнительным сглаживанием.
- **Когерентность live vs финал:** в `CoherenceEngine` во время сессии не гоняется полный секундный FFT-пайплайн; для live нужен прежде всего прогресс RSA по циклам дыхания; полный `runCoherenceSessionAnalysis` — при `finalize()` (см. комментарии в `coherence-engine.ts`). После введения `SignalTrustLevel` finger-path публикует live coherence/RSA только в состоянии `full_biometrics`; при `guided_limited` / `pulse_only` `BreathPhasePlanner` продолжает обновлять baseline BPM по `pulseBpm`, но перестаёт подпитываться RSA-циклами.
- **RSA:** `RsaEngine` — тонкая обёртка над уже посчитанным `CoherenceSessionResult` из breath-модуля (`rsa-engine.ts`).

## 4. Конфигурация и параметры

- **Камера:** `FINGER_CAMERA_CAPTURE_CONFIG` и логика в `FingerPpgCameraSource.tsx` (частота кадров, torch, разрешения).
- **Wearable BLE:** `WEARABLE_CAPTURE_CONFIG` + `BleHeartRateSource`; стандартный UUID `180D / 2A37`, generic probe path и trusted profile registry для Polar. `useWearableScanner` сканирует с фильтром `180D`, `allowDuplicates: true` и non-null scan options (iOS dev-client не вызывает `startDeviceScan(null, null, ...)`). Локальные wearable preferences хранят `preferredSensorMode`, `lastDeviceId`, `lastDeviceName`, `lastProvider`, `lastCapabilityTier`, `autoReconnect`.
- **Режим без пальца / демо:** `EmulatedPulseSensorSource` / `SimulatedSensorSource`; в `computePulseSync` (`modules/mandala-sound/core/sync.ts`) при отсутствии свежих ударов используются LFO **0.33 Гц** (дыхание) и **1.1 Гц** (пульс) — см. `FALLBACK_BREATH_HZ` / `FALLBACK_PULSE_HZ`; продуктовый смысл слоёв IBAA — в `docs/04_reference/audio/ibaa_layered_audio.md`.
- **Эмуляция пульса на шине:** канал `pulseSource`; потребители могут подавлять метрики при эмуляции (см. описание канала в `channels.ts`).

## 5. Интеграция с потребителями

- **`practices` / дыхание:** `modules/breath/ui/CoherenceBreathScreen.tsx` — монтирует `BiofeedbackProvider`, камеру/BLE, `BiofeedbackPipeline`, планировщик фаз, экспорт JSON и запись сессии через `practiceSessions`. В production-flow камера телефона теперь ведёт дыхание только по pulse/BPM; full-session HRV/coherence/RSA остаются доступными только для BLE-датчиков с RR. При длинной потере живого сигнала экран может перевести практику в `EmulatedPulseSensorSource`: для камеры реальный sensor остаётся на том же живом capture-session и продолжает держать torch, но PPG-path теперь ставится на `opticalPaused` вместо переключения всей камеры в отдельный silent reconfigure для каждого fallback-окна; recovery-пробы временно снимают эту паузу и снова пытаются поймать живой `tracking`-сигнал. Это убирает лишние camera reconfigure-прыжки в guidance-only fallback и снижает риск произвольного мигания фонарика. Для BLE runtime продолжает держать соединение/автореконнект без публикации real beats. Порог потери для camera guidance теперь опирается на **возраст последнего свежего beat**, а не только на текущий `fingerDetected`/`lockState`, поэтому fallback срабатывает даже если кадры ещё приходят, но живой pulse уже “завис”; после достижения hard-loss camera guidance-only переключается в `emulated` сразу, без повторного второго timeout. Как только камера снова даёт валидный `tracking`-пульс либо BLE снова приносит свежий HR/RR, экран автоматически и без ручного рестарта возвращает `pulseSource` обратно на живой источник. При таком возврате pipeline дополнительно сбрасывает свои time-based publish throttles, потому что camera-path использует CMTime, а emulated/BLE-path — wall-clock; без этого реальный пульс мог вернуться в merged-beats, но перестать публиковаться в results/export. Отдельно BLE-resume из background больше не использует camera-only `fingerDetected` как критерий auto-abort: wearable-путь после lock/sleep должен восстанавливаться через своё состояние RR/heart-rate, а не падать в «Практика приостановлена» из-за пустого optical snapshot. Results-stage теперь использует те же decimated runtime series для post-practice charts: pulse charts строятся по `pulseLog` как по двум явным сериям — `measuredPulseRateBpm` (что реально ещё мерил сенсор) и `guidancePulseRateBpm` (по какому BPM практика фактически вела дыхание, включая emulated fallback); при входе/выходе из fallback экран дополнительно пишет boundary-point в `pulseLog`, чтобы короткие synthetic окна не пропадали из результатов только потому, что очередной `pulseBpm` publish не попал ровно в границу переключения. BLE `RMSSD/stress` идут по редким live snapshots, RSA — по завершённым дыхательным циклам, coherence — по финальному `perSecondSmoothed` ряду. Edge-padding результатов больше не заставляет sparse BLE-series визуально заканчиваться на `4:52`, если последний live snapshot пришёл чуть раньше конца практики, а leading/trailing coherence zeros, возникшие только из-за `insufficientCoverage`, не рисуются как будто это был реальный нулевой сигнал. В debug-export `pulseLog` дополнительно пишет `lastBeatTimestampMs` / `lastBeatAgeMs`, `measuredPulseRateBpm` / `guidancePulseRateBpm`, а для wearable — ещё `wearableHeartRateBpm`, `wearableLastRrAgeMs`, `wearableSensorContactDetected` и packet counters; `runtimeEvents` сохраняют AppState / keep-awake / fallback-события текущей практики.
- **Debug / QA:** `app/biofeedback-parity.tsx` → `BiofeedbackParityScreen` поднимает **два независимых pipeline** (finger camera + BLE wearable) и рисует live-графики `BPM` и `RR` по обоим источникам, чтобы визуально сверять телефонный PPG с Polar / другими chest straps без вмешательства в production-flow дыхательной практики. Помимо beat-count / `RMSSD` / stress экран показывает live `coherence` (session average) + `RSA`, но только пока `SignalTrustLevel === "full_biometrics"`; при `guided_limited` / `pulse_only` эти поля скрываются. Coherence/RSA на parity-экране считаются через `runCoherenceSessionAnalysis` по тому же trimmed `metricBeats` ряду, что и `RMSSD` / stress — не через sparse live `CoherenceEngine.sessionBeats`, чтобы camera-path не терял покрытие из-за редких `mergedChanged` append'ов. Finger pipeline в production дополнительно append'ит полный `hrvAccumulator.getBeats()` в `CoherenceEngine` на каждом sample, а не только sparse `canonicalBeats`. Для численного parity-сравнения wearable `RMSSD` / stress отрезают стартовое окно `warmup + settle` (20 с); если после trim beats ещё недостаточно, UI держит `—`, а не ложный `0`. Экспорт v3 хранит raw `hrvValidBeats` и `metricBeats`.
- **`audio`:** `MandalaSoundProvider` подписывается на `"beat"` и строит `MandalaSoundSyncFrame` (`sync.ts`) — см. `02_modules/audio/dependencies.md`.
- **`bindu`:** `BreathBinduMandala` + `MandalaBioFrameAdapter` для uniform-полей; типы из `mandala/core/types.ts`.
- **`assistant`:** прямой передачи live HRV/когерентности в серверный диалог **нет**; связь опосредована пост-сессионными данными (например, `outcomeToCommunicatorPayload` / очередь приветствия communicator), не через шину в `dialog/route.ts`.

## 6. Подписка и доступность

- Доступ к экранам с биофидбеком завязан на продуктовые флаги практик (`breath_practices` в `modules/access/core/features.ts` для тарифов `practitioner+`), а не на отдельный feature key `biofeedback`.

## 7. Известные ограничения

- Потеря контакта, шум, движение пальца — обрабатываются `ContactMonitor`, `SignalQualityMonitor`, артефактными порогами в breath/PPG; при деградации фаза сессии уходит в `lost` / повторный warmup.
- Finger PPG остаётся **PRV**, а не ECG RR: даже после восстановления пропущенных beat'ов периферический сигнал может давать чуть большую вариабельность, чем chest strap / Polar H10, поэтому parity с wearable — цель фильтрации, но не гарантированное побитовое тождество. Именно поэтому production breath-flow больше не обещает advanced HRV/coherence/RSA от камеры телефона: они сохранены только для BLE RR-источников и debug/parity сценариев.
- Платформенные ограничения камеры/thermal throttling — см. диагностику в `CoherenceBreathScreen` (thermal, jank).
- Метрики на экране могут обновляться реже внутреннего расчёта из-за троттлинга шины.

## Справочные материалы

- docs/04_reference/biometrics/coherence_ratio.md
- docs/04_reference/biometrics/rsa.md
- docs/04_reference/biometrics/entry_time.md
- docs/04_reference/biometrics/rmssd.md
- docs/04_reference/biometrics/stress_index_baevsky.md
- docs/04_reference/biometrics/coherent_breathing.pdf
- docs/04_reference/audio/ibaa_layered_audio.md (fallback-ритмы без сигнала)
