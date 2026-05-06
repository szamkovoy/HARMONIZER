---
id: 02_modules/biofeedback/spec
title: Biofeedback Spec
version: 1.1
updated: 2026-05-07
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
    modules/biofeedback/core/metrics.ts,
    modules/biofeedback/adapters/MandalaBioFrameAdapter.ts,
    modules/biofeedback/export/SessionExporter.ts,
    modules/breath/ui/CoherenceBreathScreen.tsx,
    modules/mandala-sound/ui/MandalaSoundProvider.tsx,
    modules/mandala-sound/core/sync.ts,
  ]
---

## 1. Назначение

`biofeedback` — клиентский конвейер **PPG с камеры** (палец на вспышку), извлечение ритма ударов, оценка качества сигнала и публикация метрик в типизированную шину **`BiofeedbackBus`**. Модуль обслуживает дыхательные практики с обратной связью (прежде всего когерентное дыхание), визуализацию мандалы и звуковую модуляцию через подписчиков; тяжёлая математика когерентности/RSA для **итога сессии** живёт в `modules/breath/core/coherence-session-analysis.ts` и вызывается из `CoherenceEngine` при `finalize`, чтобы не дублировать формулы.

## 2. Публичный контракт

**Вход (сенсор):** поток `RawOpticalSample` с камеры (`timestampMs`, усреднённый канал яркости и др.) — см. `modules/biofeedback/sensors/types.ts`. Источники: `FingerPpgCameraSource` (Expo `Camera` + torch), `EmulatedPulseSensorSource`, `SimulatedSensorSource`; опционально нативный модуль `modules/biofeedback-finger-frame-processor` для ускоренной обработки кадра, если доступен.

**Ядро:** `BiofeedbackPipeline.pushOpticalSample(sample)` — единая точка входа (см. комментарии в `biofeedback-pipeline.ts`). На выходе в шину публикуются события по каналам из `channels.ts`:

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

**Агрегация для мандалы:** `MandalaBioFrameAdapter` — подписка на `beat`, `pulseBpm`, `rmssd`, `stress`, `coherence`, `contact`; метод `snapshot()` возвращает `BioSignalFrame` (`modules/mandala/core/types.ts`) с нормализованными полями для шейдера.

**Итог сессии (HRV):** `computePracticeHrvMetricsFullSession` в `core/metrics.ts` — RMSSD и индекс Баевского по **полной** серии валидных ударов после практики (см. комментарий в коде про отказ от раздельных initial/final для дыхания). Функция `updateHrvMetrics` в том же файле **не используется** текущим PPG-пайплайном (помечена для альтернативных источников RR).

## 3. Внутренняя архитектура

- **Слои:** сенсор → `OpticalRingBuffer` / bandpass → `ContactMonitor` → `SignalQualityMonitor` → `CalibrationStateMachine` → `LivePulseChannel` + merge пиков → `PulseBpmEngine`, `HrvBeatAccumulator` + `HrvEngine`, `StressEngine`, `CoherenceEngine`, `RsaEngine` — см. заголовок класса `BiofeedbackPipeline`.
- **Потоки и троттлинг:** пиковый детектор и публикации BPM/HRV/stress/coherence намеренно **редуцируются по времени** (см. константы в `BiofeedbackPipeline`) ради CPU и батареи на длинных сессиях.
- **Когерентность live vs финал:** в `CoherenceEngine` во время сессии не гоняется полный секундный FFT-пайплайн; для live нужен прежде всего прогресс RSA по циклам дыхания; полный `runCoherenceSessionAnalysis` — при `finalize()` (см. комментарии в `coherence-engine.ts`).
- **RSA:** `RsaEngine` — тонкая обёртка над уже посчитанным `CoherenceSessionResult` из breath-модуля (`rsa-engine.ts`).

## 4. Конфигурация и параметры

- **Камера:** `FINGER_CAMERA_CAPTURE_CONFIG` и логика в `FingerPpgCameraSource.tsx` (частота кадров, torch, разрешения).
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
