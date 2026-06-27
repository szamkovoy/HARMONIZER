---
id: 02_modules/biofeedback/spec
title: Biofeedback Spec
version: 1.3
updated: 2026-06-27
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
    modules/breath/ui/CoherenceBreathScreen.tsx,
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

**Итог сессии (HRV):** `computePracticeHrvMetricsFullSession` в `core/metrics.ts` — RMSSD и индекс Баевского по **полной** серии валидных ударов после практики (см. комментарий в коде про отказ от раздельных initial/final для дыхания). Функция `updateHrvMetrics` в том же файле **не используется** текущим PPG-пайплайном (помечена для альтернативных источников RR). BLE-capability tiers: `fullMetrics` — RR пришёл и downstream-метрики считаются как обычно; `guidedOnly` — есть только heart-rate pacing, pipeline ставит `metricsCapturePaused`; `unsupported` — UI не должен запускать метрики/биометрию.

## 3. Внутренняя архитектура

- **Слои:** сенсор → `OpticalRingBuffer` / bandpass → `ContactMonitor` → `SignalQualityMonitor` → `CalibrationStateMachine` → `LivePulseChannel` + merge пиков → `PulseBpmEngine`, `HrvBeatAccumulator` + `HrvEngine`, `StressEngine`, `CoherenceEngine`, `RsaEngine` — см. заголовок класса `BiofeedbackPipeline`.
- **Wearable path:** `useWearableScanner` ищет BLE-устройства по Heart Rate Service / имени, `BleHeartRateSource` подключается через `@sfourdrinier/react-native-ble-plx`, парсит characteristic `0x2A37`, конвертирует RR (`1/1024 s`) в beat timestamps и отдаёт их в тот же pipeline. RR в пакете разворачиваются **назад от `nowMs`** (`wearableBeatTimeline.ts`, контракт HRS: `rr[0]` — oldest), но в merged-ленту попадают **только метки после последнего committed beat** — иначе multi-RR notify (Polar) даёт RR-пилу 750/250 ms и withhold coherence. Для `pulseSource=wearable` `BiofeedbackPipeline.pushBeatEvent` не подменяет `canonicalBeats` PPG-фильтром `PulseBpmEngine` — chest strap идёт в coherence/HRV из merged-ленты; finger PPG path не меняется. Общий `WearablePickerDialog` (окно **12 с**) переиспользуется в `PracticeCard` и runtime recovery в `CoherenceBreathScreen`. Для trusted Polar-профилей (`Polar H10`, `Polar H9`) UI помечает источник как `polarEnhanced`, но downstream-метрики остаются общими.
- **Потоки и троттлинг:** пиковый детектор и публикации BPM/HRV/stress/coherence намеренно **редуцируются по времени** (см. константы в `BiofeedbackPipeline`) ради CPU и батареи на длинных сессиях.
- **RR filtering policy:** `PulseBpmEngine` различает `fingerCamera` и `wearable` для **live BPM display** (окно RR `300..2000 ms`, ослабленный deviation). Coherence/HRV для BLE берут merged beats напрямую; PPG-фильтр применяется только к finger camera.
- **Когерентность live vs финал:** в `CoherenceEngine` во время сессии не гоняется полный секундный FFT-пайплайн; для live нужен прежде всего прогресс RSA по циклам дыхания; полный `runCoherenceSessionAnalysis` — при `finalize()` (см. комментарии в `coherence-engine.ts`).
- **RSA:** `RsaEngine` — тонкая обёртка над уже посчитанным `CoherenceSessionResult` из breath-модуля (`rsa-engine.ts`).

## 4. Конфигурация и параметры

- **Камера:** `FINGER_CAMERA_CAPTURE_CONFIG` и логика в `FingerPpgCameraSource.tsx` (частота кадров, torch, разрешения).
- **Wearable BLE:** `WEARABLE_CAPTURE_CONFIG` + `BleHeartRateSource`; стандартный UUID `180D / 2A37`, generic probe path и trusted profile registry для Polar. `useWearableScanner` сканирует с фильтром `180D`, `allowDuplicates: true` и non-null scan options (iOS dev-client не вызывает `startDeviceScan(null, null, ...)`). Локальные wearable preferences хранят `preferredSensorMode`, `lastDeviceId`, `lastDeviceName`, `lastProvider`, `lastCapabilityTier`, `autoReconnect`.
- **Режим без пальца / демо:** `EmulatedPulseSensorSource` / `SimulatedSensorSource`; в `computePulseSync` (`modules/mandala-sound/core/sync.ts`) при отсутствии свежих ударов используются LFO **0.33 Гц** (дыхание) и **1.1 Гц** (пульс) — см. `FALLBACK_BREATH_HZ` / `FALLBACK_PULSE_HZ`; продуктовый смысл слоёв IBAA — в `docs/04_reference/audio/ibaa_layered_audio.md`.
- **Эмуляция пульса на шине:** канал `pulseSource`; потребители могут подавлять метрики при эмуляции (см. описание канала в `channels.ts`).

## 5. Интеграция с потребителями

- **`practices` / дыхание:** `modules/breath/ui/CoherenceBreathScreen.tsx` — монтирует `BiofeedbackProvider`, камеру, `BiofeedbackPipeline`, планировщик фаз, гибридный контроллер измерений, экспорт JSON, запись сессии через `practiceSessions`.
- **`audio`:** `MandalaSoundProvider` подписывается на `"beat"` и строит `MandalaSoundSyncFrame` (`sync.ts`) — см. `02_modules/audio/dependencies.md`.
- **`bindu`:** `BreathBinduMandala` + `MandalaBioFrameAdapter` для uniform-полей; типы из `mandala/core/types.ts`.
- **`assistant`:** прямой передачи live HRV/когерентности в серверный диалог **нет**; связь опосредована пост-сессионными данными (например, `outcomeToCommunicatorPayload` / очередь приветствия communicator), не через шину в `dialog/route.ts`.

## 6. Подписка и доступность

- Доступ к экранам с биофидбеком завязан на продуктовые флаги практик (`breath_practices` в `modules/access/core/features.ts` для тарифов `practitioner+`), а не на отдельный feature key `biofeedback`.

## 7. Известные ограничения

- Потеря контакта, шум, движение пальца — обрабатываются `ContactMonitor`, `SignalQualityMonitor`, артефактными порогами в breath/PPG; при деградации фаза сессии уходит в `lost` / повторный warmup.
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
