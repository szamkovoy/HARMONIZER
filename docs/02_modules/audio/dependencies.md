---
id: 02_modules/audio/dependencies
title: Audio Dependencies
version: 1.4
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

- **`practices` (в т.ч. дыхательный подсценарий; реализация в `modules/breath/`)**  
  Продуктово фазы дыхания — часть модуля **`practices`**; в коде тип **`PlannedCycle`** и тайминг цикла импортируются в `mandala-sound` из **`modules/breath/core/breath-phase-planner.ts`** (`core/types.ts`, `core/sync.ts`) как вход для `computeBreathSync()`. Монтаж и props провайдера — **`modules/breath/ui/CoherenceBreathScreen.tsx`** (роут `app/breath-coherence.tsx`): `practiceKind`, `durationMs`, `chakra`, `plannedCycle`, `cycleStartMs`, `biofeedbackEnabled`. Пакет **`modules/practices/`** в `mandala-sound` не импортируется — связь документируется как **practices → внутренний код breath**.

- **`bindu` (контракт мандалы в `modules/mandala/core`)**  
  `modules/mandala-sound/core/sync.ts` импортирует **`buildAudioContract()`** из `modules/mandala/core/bio.ts` и **`AudioBandTrigger`** из `modules/mandala/core/types.ts`; через них считаются `textureBrightness`, гейны дорожек, **`flickerHz`** (равен `targetHz` из таймлайна), **`flickerIntensity`** и `gongTrigger`. Пакет **`mandala-sound` не импортирует** React-канвасы bindu — мандала получает уже готовый `MandalaSoundVisualSync` снаружи (см. §2).

## 2. От него зависят

- **`practices`**  
  `app/breath-coherence.tsx` → `modules/breath/ui/CoherenceBreathScreen.tsx`: монтирует `MandalaSoundProvider`, читает `useMandalaSoundSync()` для `BreathBinduMandala` и `useMandalaSoundFrame()` для debug-footer в test mode. Сценарий не крутит таймер сам: задаёт только props (`plannedCycle`, `cycleStartMs`, …); тик `setInterval(..., CONTROL_TICK_MS)` и расчёт `flickerHz` — внутри `mandala-sound`.

- **`bindu`**  
  `modules/mandala/experiments/SacredSymbolStreamScreen.tsx` — локальный `MandalaSoundProvider` и `useMandalaSoundSync()` в `BinduSuccessionFlowCanvas`.  
  `BinduSuccessionLabCanvas` / `BinduSuccessionFlowCanvas` — опциональный проп `externalSync?: MandalaSoundVisualSync` (тип из `@/modules/mandala-sound`; поля `externalFlickerHz` / `externalFlickerIntensity` соответствуют `flickerHz` / `flickerIntensity` у провайдера).

## 3. Контрактные точки риска

- `PlannedCycle` и `cycleStartMs` трактуются как уже замороженный план цикла. Смена контракта в `modules/breath/core/breath-phase-planner.ts` (внутренняя часть сценария practices) сломает `computeBreathSync()` без compile-time ошибки.
- `audio` импортирует `buildAudioContract()` и `AudioBandTrigger` из **`modules/mandala/core`** (документируемый контур bindu), а не дублирует их локально. Любое изменение порогов band, структуры `MandalaAudioContract` или семантики gong-trigger меняет и звук, и `flickerHz`/мерцание сразу.
- Канал `"beat"` и форма `BeatEvent` (`timestampMs`, `source`, `confidence`) зашиты в pulse sync. Переименование канала, смена единиц времени или новая семантика `source` тихо сломают fallback и pulse-driven gain.
- `MandalaSoundVisualSync` сейчас минимален: `flickerHz`, `flickerIntensity`, `breathPhase`, `pulsePhase`. Bindu-канвасы используют только flicker-поля, но тип импортируется наружу; несовместимое изменение типа затронет и `practices`, и `bindu`.
- `ExpoMandalaSoundEngine` рассчитан на best-effort обновления и пропускает overlapping ticks. Изменение `CONTROL_TICK_MS` или removal логики `updateInFlight` может вернуть аудиолаги в тяжёлых дыхательных сессиях.
