# BIOFEEDBACK

Модуль биологической обратной связи. Извлекает из живого сигнала пульса:

- события отдельных ударов сердца (live pulse channel) — для синхронизации дыхания и пульсаций мандалы;
- средний BPM (10 c) — для UI и расчётов;
- RMSSD и индекс Баевского (по тиерам валидных ударов) — для долгосрочного отслеживания;
- коэффициент когерентности (60 c FFT по тахограмме 4 Гц) — для дыхательной практики;
- амплитуду RSA (по дыхательным циклам) — там же.

Все метрики публикуются в `BiofeedbackBus`. Любой модуль (Breath, Mandala, Assistant, Probe)
подписывается на нужные каналы.

> Архитектура подробно описана в **[`docs/biofeedback-architecture.md`](../../docs/biofeedback-architecture.md)** —
> диаграмма слоёв, контракты каналов, правила расширения.

## Структура

```
sensors/        — источники биометрии (PPG камера, симулятор; в будущем: face rPPG, watch, BLE, Edge-AI)
signal/         — оптика (детренд + bandpass + MA), пиковый детектор, merge ударов
quality/        — контакт пальца, качество сигнала, единый протокол калибровки (warmup 10s + settle 10s)
engines/        — LivePulseChannel, PulseBpmEngine, HrvEngine, StressEngine, CoherenceEngine, RsaEngine
bus/            — BiofeedbackBus + Pipeline + React-обвязка
adapters/       — адаптеры наружу (Mandala BioSignalFrame)
export/         — JSON v3 (SessionExporter) + опциональный PerStageLogger
core/           — историческая папка: типы (`types.ts`), математика метрик (`metrics.ts`), пороги HRV
ui/             — отладочный «инспектор каналов» (BiofeedbackProbeScreen)
```

## Pipeline

`bus/biofeedback-pipeline.ts::BiofeedbackPipeline` — «сборщик», который связывает источник, signal, quality и engines.
Источники полиморфны:
- `pipeline.pushOpticalSample(sample)` — для PPG-камеры (через `FingerPpgCameraSource`);
- `pipeline.pushBeatEvent(nowMs, beatTs)` — для готовых beat-источников (симулятор, watch).

Калибровка для готовых beat-источников пропускается через
`pipeline.markCalibrationCompleteForBeatSource(now)`.

## Использование (минимальный пример)

```tsx
import { BiofeedbackProvider } from "@/modules/biofeedback/bus/biofeedback-provider";
import { useBiofeedbackChannel } from "@/modules/biofeedback/bus/react";
import { FingerPpgCameraSource } from "@/modules/biofeedback/sensors/FingerPpgCameraSource";
import { FINGER_CAMERA_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";

function PulseBadge() {
  const pulse = useBiofeedbackChannel("pulseBpm");
  return <Text>{pulse?.bpm.toFixed(0) ?? "—"} BPM</Text>;
}

function MyScreen() {
  return (
    <BiofeedbackProvider config={FINGER_CAMERA_CAPTURE_CONFIG}>
      <FingerPpgCameraSource isActive />
      <PulseBadge />
    </BiofeedbackProvider>
  );
}
```

## Каналы

См. `bus/channels.ts` и таблицу в `docs/biofeedback-architecture.md`.

| `contact` | `session` | `pulseBpm` | `beat` | `rmssd` | `stress` | `coherence` | `rsa` | `optical` | `error` |

## Parity и инварианты

Все формулы (RMSSD, Баевский, RSA, когерентность) сохранены без изменений: новые engines
переиспользуют чистые функции из `core/metrics.ts` и `breath/core/coherence-session-analysis.ts`.
Проверочный список: **[`docs/biofeedback-parity-contract.md`](../../docs/biofeedback-parity-contract.md)**.

## Экспорт

`export/SessionExporter.ts::buildSessionExportV3` собирает JSON c `schemaVersion: 3`. Файл
содержит версии всех engines, конфигурацию когерентного анализа, snapshot конвейера
(merged beats, hrvValid beats), и историю каналов Bus за последние ~256 событий.

## Probe

`ui/BiofeedbackProbeScreen.tsx` — отладочный «инспектор каналов» (~250 строк, заменил
1419-строчный legacy-экран). Показывает live-значения каждого канала, умеет запустить
тестовую coherence-сессию и выгрузить JSON v3.

## Расширение

- **Новый сенсор**: реализовать `BiofeedbackSensor` (`sensors/types.ts`) и компонент-обёртку
  по образцу `SimulatedSensorSource.tsx`. Для готовых beat-источников выставить
  `producesBeats: true` и пушить через `pipeline.pushBeatEvent`.
- **Новый engine**: создать класс в `engines/` с `push()` методом, добавить тип события в
  `bus/channels.ts`, дёрнуть `bus.publish(channel, event)` из Pipeline.
- **Новая дыхательная техника**: см. `modules/breath/readme.md`.
