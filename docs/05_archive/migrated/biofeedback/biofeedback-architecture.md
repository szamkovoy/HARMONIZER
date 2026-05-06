# Biofeedback Architecture (после рефакторинга 2026)

Этот документ описывает целевую архитектуру модуля Biofeedback и его связь с Breath/Mandala.
Заменяет старое описание из `modules/biofeedback/readme.md` (которое отражало 1338-строчный
`FingerSignalAnalyzer`-«God object» и было удалено).

## Слои

```
sensors/        — источники биометрии (PPG камера, симулятор, в будущем watch/BLE/Edge AI)
signal/         — оптика → пики → merge ударов
quality/        — контакт, качество, единый протокол калибровки
engines/        — отдельные engine на каждую метрику (LivePulse / PulseBpm / HRV / Stress / Coherence / RSA)
bus/            — BiofeedbackBus + Pipeline + React-обвязка (контекст, hooks)
adapters/       — адаптеры наружу (Mandala BioSignalFrame)
export/         — JSON-экспорт v3 + PerStageLogger
```

## Принципы

1. **Одна метрика — один engine.** Правка RMSSD затрагивает только `HrvEngine`.
2. **Два разных пульса**: `LivePulseChannel` (события ударов с экстраполяцией для синка
   дыхания), `PulseBpmEngine` (скользящее среднее 10 с для UI).
3. **Единый протокол старта** — `CalibrationStateMachine`. Экраны не дублируют логику.
4. **EMA-сглаживание — в UI-адаптерах**. Engines выдают сырые значения для экспорта.
5. **Sensor интерфейс полиморфен**: PPG-источники — `RawOpticalSample`; готовые
   beat-источники (Apple Watch, BLE HR, Edge-AI детектор) — `BeatEvent`, минуя
   OpticalPipeline и PeakDetector.

## Каналы Bus

| Канал | Полезная нагрузка | Кто публикует | Частота |
| --- | --- | --- | --- |
| `contact` | `{ state, confidence, absentForMs }` | `ContactMonitor` | при изменении |
| `session` | `{ phase, warmupElapsedMs, settleGoodMsAccum, becameReady, becameLost }` | `CalibrationStateMachine` | при переходе |
| `beat` | `{ beat: { timestampMs, source: "detected"|"extrapolated" } }` | `LivePulseChannel` | на каждый удар |
| `pulseBpm` | `{ bpm, windowSeconds, lockState, hasFreshBeat, confidence }` | `PulseBpmEngine` | ~2 Hz |
| `rmssd` | `{ rmssdMs, segment, tier, validBeatCount, approximate }` | `HrvEngine` | при обновлении |
| `stress` | `{ percent, rawIndex, segment, tier, approximate }` | `StressEngine` | при обновлении |
| `coherence` | `{ currentPercent, averagePercent, maxPercent, smoothedSeries, entryTimeSec }` | `CoherenceEngine` | 1 Hz во время сессии |
| `rsa` | `{ amplitudeBpm, normalizedPercent, activeCycleCount }` | `RsaEngine` | по циклу дыхания |
| `optical` | `RawOpticalSample` | sensor | каждый кадр |
| `error` | `{ source, message }` | любой engine | при ошибке |

## Подписка

Все экраны и потребители используют `BiofeedbackBusProvider` + хуки из `bus/react.tsx`:

```tsx
import { useBiofeedbackChannel, useBiofeedbackSubscribe } from "@/modules/biofeedback/bus/react";

function MyComponent() {
  const pulse = useBiofeedbackChannel("pulseBpm");      // re-render на каждом событии
  useBiofeedbackSubscribe("beat", (e) => playGong());   // только side-effect
  return <Text>{pulse?.bpm.toFixed(0)}</Text>;
}
```

## Pipeline

`BiofeedbackPipeline` — «сборщик» (`bus/biofeedback-pipeline.ts`), связывающий все слои.
Экраны не работают с ним напрямую, кроме особых случаев:
- `pipeline.getCoherenceEngine().startSession({...})` — для запуска практики;
- `pipeline.getCoherenceEngine().finalize(endMs)` — для финализации;
- `pipeline.getMergedBeats()` / `pipeline.getLastSourceTimestampMs()` — для отладки.

Источники мульти-полиморфны:
- `pipeline.pushOpticalSample(sample)` — для PPG-камеры (через `FingerPpgCameraSource`);
- `pipeline.pushBeatEvent(nowMs, beatTs)` — для готовых beat-источников (симулятор, watch).

## Provider

```tsx
import { BiofeedbackProvider } from "@/modules/biofeedback/bus/biofeedback-provider";
import { FINGER_CAMERA_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";

<BiofeedbackProvider config={FINGER_CAMERA_CAPTURE_CONFIG}>
  <FingerPpgCameraSource isActive={...} />  {/* или SimulatedSensorSource */}
  <YourScreen />
</BiofeedbackProvider>
```

## Mandala интеграция

`adapters/MandalaBioFrameAdapter.ts` подписывается на каналы Bus и периодически
выдаёт `BioSignalFrame` для рантайма Mandala (Skia визуализатор). EMA-сглаживание
дисплея — внутри адаптера.

## Экспорт

`export/SessionExporter.ts` (`buildSessionExportV3`) — единый формат экспорта для
любого экрана. Содержит:
- версии всех engines и их конфигурацию;
- `pipelineSnapshot`: текущее merged-удары, hrvValid удары, last RR;
- `channelLog`: история N последних публикаций по каждому каналу;
- `coherence`: данные активной/завершённой когерентной сессии.

JSON-схему версии 3 — пишет именно этот файл. Старая v2 (`buildCoherenceExportJson`
из `coherence-session-analysis.ts`) сохранена для обратной совместимости разбора и
используется на экране `CoherenceBreathScreen` для legacy-выгрузки.

## Migration map

| Старое место | Новое место |
| --- | --- |
| `core/finger-analysis.ts::FingerSignalAnalyzer` | разобран по `signal/`, `quality/`, `engines/`, `bus/biofeedback-pipeline.ts` |
| `core/finger-analysis.ts::detectBeats` | `signal/peak-detector.ts` |
| `core/finger-analysis.ts::mergeBeatTimestampsPhase1` | `signal/beat-merger.ts` |
| `core/finger-analysis.ts::OpticalRingBuffer (анонимная)` | `signal/optical-pipeline.ts::OpticalRingBuffer` |
| `core/mandala-adapter.ts` | `adapters/MandalaBioFrameAdapter.ts` |
| `breath/ui/BreathFingerCapture.tsx` | `sensors/FingerPpgCameraSource.tsx` |
| `breath/core/simulated-beats.ts` | `sensors/simulated-sensor.ts` |
| `core/finger-measurement-session.ts` | удалён (его заменяет `export/SessionExporter.ts` v3) |
| `core/simulated.ts` | удалён (фейковый `BiofeedbackFrame`); вместо него — `SimulatedSensor` |
| `BiofeedbackProbeScreen` (1419 строк) | переписан как «инспектор каналов» (~250 строк) |
| `CoherenceBreathScreen` (957 строк, allSessionBeatsRef) | переписан на Bus (`pipeline.getCoherenceEngine`) |

## Что НЕ изменилось (сохранено по требованию parity)

- Математика RMSSD / индекс Баевского — `core/metrics.ts` (без изменений).
- Анализ когерентности и RSA — `breath/core/coherence-session-analysis.ts` (без изменений).
- Тахограмма 4 Гц и очистка RR — `breath/core/tachogram-4hz.ts` (без изменений).
- Butterworth SOS bandpass — `signal/ppg-bandpass.ts` (перенесён, формулы сохранены).
- Параметры тиров HRV — `core/hrv-practice-constants.ts`.

## Расширение

Чтобы добавить **новую дыхательную технику** (канальное дыхание, квадрат, треугольники):

1. Добавить в `breath/core/breath-practice.ts` запись с inhaleMs/exhaleMs/holdMs и описанием.
2. Создать UI-экран по образцу `CoherenceBreathScreen`, переиспользуя `BiofeedbackProvider`.
3. Подписаться на `beat` для синхронизации с пульсом, `pulseBpm` для отображения.
4. Если техника требует другой статистики (например, скорость вхождения в поток) — это
   уже есть в `CoherenceEngine`; пользоваться `pipeline.getCoherenceEngine().startSession`.

Чтобы добавить **новый источник данных** (Apple Watch / BLE HR):

1. Реализовать `BiofeedbackSensor` интерфейс в `sensors/`. Для готовых beat-источников
   `producesBeats = true`, и в `start()` вызывать `listeners.onBeatEvent(...)`.
2. Добавить React-обёртку (по образцу `SimulatedSensorSource.tsx`), которая подписывается
   на `useBiofeedbackPipeline()` и вызывает `pipeline.pushBeatEvent(...)`.
3. Для готовых beat-источников нужно вызвать
   `pipeline.markCalibrationCompleteForBeatSource(now)` при старте — пропускаем калибровку.
