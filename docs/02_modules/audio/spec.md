---
id: 02_modules/audio/spec
title: Audio Spec
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/biofeedback/spec, 02_modules/bindu/spec, 02_modules/infra/spec]
code_refs: [modules/mandala-sound/index.ts, modules/mandala-sound/core/engine.ts, modules/mandala-sound/core/sync.ts, modules/mandala-sound/core/timeline.ts, modules/mandala-sound/ui/MandalaSoundProvider.tsx]
---

## 1. Назначение

`audio` добавляет к активной практике тихий адаптивный звуковой слой и держит его в одном ритме с визуальным Bindu-контуром. Модуль не является отдельным экраном: он монтируется внутри дыхательной и медитативной сессии, собирает sync-кадр из таймлайна, дыхания и beat-событий, затем обновляет `expo-av` loops и отдаёт visual sync наружу.

## 2. Публичный контракт

- `MANDALA_SOUND_ASSETS: MandalaSoundAssetPreset`  
  Манифест локальных ассетов: `drones`, `textures`, `binaural`, `gongs`, `events`.
- `class ExpoMandalaSoundEngine implements MandalaSoundEngineControls`  
  `start(chakra: number): Promise<void>`  
  `update(frame: MandalaSoundSyncFrame): Promise<void>`  
  `stop(): Promise<void>`
- `buildMandalaSoundFrame(args: { startedAtMs: number; nowMs: number; durationMs: number; plannedCycle?: PlannedCycle | null; cycleStartMs?: number | null; lastBeat?: BeatEvent | null; lastRrMs?: number | null; previousBand: MandalaSoundBand | null; hueMain?: number; zoomVelocity?: number }): MandalaSoundSyncFrame`
- `computeBreathSync(plannedCycle: PlannedCycle | null | undefined, cycleStartMs: number | null | undefined, nowMs: number): MandalaSoundBreathSync`
- `computePulseSync(args: { lastBeat?: BeatEvent | null; lastRrMs?: number | null; nowMs: number }): MandalaSoundPulseSync`
- `detectGongTransition(previousBand: MandalaSoundBand | null, currentBand: MandalaSoundBand): AudioBandTrigger["id"] | null`
- `getMandalaSoundTargetHz(elapsedMs: number, durationMs: number): number`
- `getMandalaSoundBand(targetHz: number): MandalaSoundBand`
- `MandalaSoundProvider(props: PropsWithChildren<MandalaSoundSessionInput & { biofeedbackEnabled?: boolean }>)`
- `useMandalaSoundFrame(): MandalaSoundSyncFrame`
- `useMandalaSoundSync(): MandalaSoundVisualSync`
- Экспортируемые типы: `MandalaSoundAssetPreset`, `MandalaSoundBand`, `MandalaSoundBreathSync`, `MandalaSoundEngineControls`, `MandalaSoundPracticeKind`, `MandalaSoundPulseSync`, `MandalaSoundSessionInput`, `MandalaSoundSyncFrame`, `MandalaSoundVisualSync`.

## 3. Внутренняя архитектура

- `MandalaSoundProvider` управляет жизненным циклом сессии: стартует движок при `isActive`, держит `startedAtMs`, `previousBand`, локальный beat/RR state и раз в `250 ms` собирает новый `MandalaSoundSyncFrame`.
- `core/timeline.ts` переводит прогресс практики в целевой brainwave диапазон. Короткие сессии остаются в `theta`, длинные доходят до `delta`; band определяется порогами `beta/alpha/theta/delta`.
- `core/sync.ts` собирает sync-кадр: дыхание берётся из `PlannedCycle`, пульс из `BeatEvent` с fallback на LFO, затем через `buildAudioContract()` из Bindu-контракта вычисляются `textureBrightness`, `droneGain`, `textureGain`, `binauralGain`, `flickerHz`, `flickerIntensity` и `gongTrigger`.
- `ExpoMandalaSoundEngine` не синтезирует звук на лету. Он заранее загружает loops через `expo-av`, держит громкости почти на нуле и на каждом тике обновляет `drone`, две `texture`-дорожки и текущий binaural band; `gongs` и `events` играются как best-effort one-shot.
- Визуальный слой получает только `MandalaSoundVisualSync` через `useMandalaSoundSync()`. Так дыхательная мандала и `BinduSuccessionFlowCanvas` мерцают в том же диапазоне, что и звук.

## 4. Конфигурация и параметры

- Внешние входы провайдера: `practiceKind: "breath" | "meditation"`, `durationMs`, `chakra`, `isActive`, `plannedCycle`, `cycleStartMs`, `biofeedbackEnabled`.
- Выбор чакры влияет на `drone` и пару `texture`-лупов. Сейчас доступны `7` drone-ассетов по чакрам и `3` texture-лупа с циклическим выбором пары.
- Таймлайн зависит только от длины сессии:  
  `duration < 6 min` -> `14 -> 10 -> 7.5 Hz`  
  `6-12 min` -> `15 -> 10 -> 6 -> 5 Hz`  
  `>= 12 min` -> `16 -> 10 -> 6 -> 2.5 -> 2 Hz`
- Binaural preset дискретный: `beta=16 Hz`, `alpha=10 Hz`, `theta=6 Hz`, `delta=2.5 Hz`. `gongTrigger` появляется только при входе в `alpha/theta/delta`.
- Внутренние runtime-настройки зашиты в код: `CONTROL_TICK_MS = 250`, pulse fallback включается после `2200 ms` без beat-события, event cooldown `42000 ms`.

## 5. Известные ограничения

- Движок основан на `expo-av` volume control, а не на AudioWorklet/JSI DSP. `targetHz` меняется плавно внутри кадра, но binaural audio переключается дискретно по band loops, а не как непрерывный per-ear oscillator.
- Историческое ТЗ про `70` текстур, `20` событий и live-фильтры не соответствует текущему коду: сейчас в рантайме только `7` drones, `3` textures, `4` binaural loops, `3` gongs и `3` events.
- Эффект binaural beats практически требует наушников; через динамик телефона каналы смешиваются.
- Провайдер жёстко связан с контрактами `bindu` (`buildAudioContract`, `AudioBandTrigger`) и с `PlannedCycle` из дыхательной практики. Это не изолированный движок и любые изменения этих типов меняют поведение `audio`.
- При перегрузке JS-потока `ExpoMandalaSoundEngine` пропускает overlapping updates вместо очереди. Это защищает практику от накопления лагов, но делает звуковую модуляцию менее точной на слабых устройствах.
- Отдельной web-адаптации нет: код ориентирован на Expo/RN runtime. Если нативный audio backend отказывает, visual sync продолжает работать, но звук остаётся отключённым.
## Справочные материалы

- docs/04_reference/audio/ibaa_layered_audio.md
- docs/04_reference/audio/trance_protocol.md

При следующей сессии разработки в модуле `audio` проверить открытое решение про скорость снижения частоты, см. `docs/04_reference/audio/ibaa_layered_audio.md`, раздел `Открытые решения`.
