---
id: 02_modules/audio/dependencies
title: Audio Dependencies
version: 1.2
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/biofeedback/spec, 02_modules/bindu/spec, 02_modules/infra/spec]
code_refs: [modules/mandala-sound/index.ts, modules/mandala-sound/core/engine.ts, modules/mandala-sound/core/sync.ts, modules/mandala-sound/core/timeline.ts, modules/mandala-sound/ui/MandalaSoundProvider.tsx]
---

## 1. Зависит от

- `infra`  
  `modules/mandala-sound/core/engine.ts` использует `expo-av` (`Audio.setAudioModeAsync`, `Audio.Sound.createAsync`) как единственный runtime backend для loops и one-shot playback.  
  `modules/mandala-sound/core/engine.ts` и `modules/mandala-sound/ui/MandalaSoundProvider.tsx` логируют lifecycle через `services/runtimeDiagnostics.ts`.  
  `modules/mandala-sound/core/assets.ts` опирается на локальный asset pipeline `assets/audio/mandala-sound/*`; изменение путей или схемы упаковки ломает инициализацию движка без изменения публичного API.

- `biofeedback`  
  `modules/mandala-sound/ui/MandalaSoundProvider.tsx` подписывается на канал `"beat"` через `useBiofeedbackSubscribe()` из `modules/biofeedback/bus/react.tsx`, чтобы обновлять RR-интервал без лишнего re-render экрана.  
  `modules/mandala-sound/core/sync.ts` использует `BeatEvent` из `modules/biofeedback/sensors/types.ts` и строит `pulse.phase/confidence/source`, после чего модулирует `droneGain`, `flickerIntensity` и fallback-поведение. Обратная сторона контракта — `docs/02_modules/biofeedback/dependencies.md` (потребитель `audio`).

- `practices`  
  `modules/mandala-sound/core/types.ts` и `modules/mandala-sound/core/sync.ts` зависят от `PlannedCycle` из `modules/breath/core/breath-phase-planner.ts`; для дыхательных сессий это источник истины по фазе вдоха/выдоха.  
  `modules/breath/ui/CoherenceBreathScreen.tsx` передаёт в `MandalaSoundProvider` `practiceKind="breath"`, `durationMs`, `chakra`, `plannedCycle`, `cycleStartMs` и `biofeedbackEnabled`, тем самым формируя контракт интеграции со стороны practice runtime.

- `bindu`  
  `modules/mandala-sound/core/sync.ts` использует `buildAudioContract()` из `modules/mandala/core/bio.ts` и `AudioBandTrigger` из `modules/mandala/core/types.ts`; через них `audio` синхронизирует `textureBrightness`, binaural target и gong band с визуальной моделью мандалы.  
  Визуальные потребители в `modules/breath/ui/BreathBinduMandala.tsx`, `modules/mandala/experiments/BinduSuccessionLabCanvas.tsx` и `modules/mandala/experiments/BinduSuccessionFlowCanvas.tsx` принимают `MandalaSoundVisualSync` как `externalSync` и используют `flickerHz/flickerIntensity` в shader uniforms.

## 2. От него зависят

- `practices`  
  `modules/breath/ui/CoherenceBreathScreen.tsx` оборачивает активную дыхательную сессию в `MandalaSoundProvider`, читает `useMandalaSoundSync()` для `BreathBinduMandala` и `useMandalaSoundFrame()` для debug-footer в test mode.  
  Практика не управляет движком напрямую: её контракт с `audio` ограничен props провайдера и хуками контекста.

- `bindu`  
  `modules/mandala/experiments/SacredSymbolStreamScreen.tsx` оборачивает медитативный flow в `MandalaSoundProvider` и передаёт `useMandalaSoundSync()` в `BinduSuccessionFlowCanvas`.  
  `BinduSuccessionLabCanvas` и `BinduSuccessionFlowCanvas` зависят от полей `externalFlickerHz` и `externalFlickerIntensity`, которые сейчас приходят именно из `MandalaSoundVisualSync`.

## 3. Контрактные точки риска

- `PlannedCycle` и `cycleStartMs` трактуются как уже замороженный план цикла. Если `practices` перейдёт на другой источник дыхательной фазы, `computeBreathSync()` начнёт давать неверную модуляцию без явной compile-time ошибки.
- `audio` импортирует `buildAudioContract()` и `AudioBandTrigger` из `bindu`, а не дублирует их локально. Любое изменение band thresholds, структуры `MandalaAudioContract` или семантики gong-trigger в `bindu` меняет и звук, и визуальную синхронизацию сразу.
- Канал `"beat"` и форма `BeatEvent` (`timestampMs`, `source`, `confidence`) зашиты в pulse sync. Переименование канала, смена единиц времени или новая семантика `source` тихо сломают fallback и pulse-driven gain.
- `MandalaSoundVisualSync` сейчас минимален: `flickerHz`, `flickerIntensity`, `breathPhase`, `pulsePhase`. Bindu-канвасы используют только flicker-поля, но тип импортируется наружу; несовместимое изменение типа затронет и `practices`, и `bindu`.
- `ExpoMandalaSoundEngine` рассчитан на best-effort обновления и пропускает overlapping ticks. Изменение `CONTROL_TICK_MS` или removal логики `updateInFlight` может вернуть аудиолаги в тяжёлых дыхательных сессиях.
