---
id: 02_modules/audio/dependencies
title: Audio Dependencies
version: 1.6
updated: 2026-08-24
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/biofeedback/spec, 02_modules/bindu/spec, 02_modules/i18n/spec, 02_modules/infra/spec]
code_refs: [modules/mandala-sound/index.ts, modules/mandala-sound/core/engine.ts, modules/mandala-sound/core/sync.ts, modules/mandala-sound/core/timeline.ts, modules/mandala-sound/ui/MandalaSoundProvider.tsx]
---

## 1. Зависит от

- `infra`  
  `modules/mandala-sound/core/engine.ts` и `modules/mandala-sound/core/ambientEngine.ts` используют `expo-audio` (`createAudioPlayer`, `setAudioModeAsync`, `AudioPlayer.setActiveForLockScreen`) как runtime backend для loops и one-shot playback. Config-плагин `expo-audio` (`enableBackgroundPlayback: true` в `app.config.ts`) добавляет Android foreground service `AudioControlsService` (тип `mediaPlayback`) + permissions `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` и iOS `UIBackgroundMode: audio` — это обязательный платформенный контракт для длительного фонового аудио на Android 14+ (без `setActiveForLockScreen` ОС останавливает аудио через ~3 минуты в Doze). `expo-av` остаётся в проекте только для записи микрофона (Communicator / whisper / affirmations) и НЕ используется в `mandala-sound`.  
  `modules/mandala-sound/core/engine.ts` и `modules/mandala-sound/ui/MandalaSoundProvider.tsx` логируют lifecycle через `services/runtimeDiagnostics.ts`.  
  `modules/mandala-sound/core/assets.ts` опирается на локальный asset pipeline `assets/audio/mandala-sound/*`; изменение путей или схемы упаковки ломает инициализацию движка без изменения публичного API.  
  `modules/mandala-sound/core/ambientAssets.ts` / `AmbientLoopEngine` — тот же `expo-audio` для `assets/audio/ambient/*.m4a`. Обложка lock-screen резолвится в локальный `file://` URI через `expo-asset` (`resolveLocalArtworkUri`).

- `biofeedback`  
  `modules/mandala-sound/ui/MandalaSoundProvider.tsx` подписывается на канал `"beat"` через `useBiofeedbackSubscribe()` из `modules/biofeedback/bus/react.tsx`, чтобы обновлять RR-интервал без лишнего re-render экрана.  
  `modules/mandala-sound/core/sync.ts` использует `BeatEvent` из `modules/biofeedback/sensors/types.ts` и строит `pulse.phase/confidence/source`, после чего модулирует `droneGain`, `flickerIntensity` и fallback-поведение. Обратная сторона контракта — `docs/02_modules/biofeedback/dependencies.md` (потребитель `audio`).

- **`practices` (в т.ч. дыхательный подсценарий; реализация в `modules/breath/`)**  
  Продуктово фазы дыхания — часть модуля **`practices`**; в коде тип **`PlannedCycle`** и тайминг цикла импортируются в `mandala-sound` из **`modules/breath/core/breath-phase-planner.ts`** (`core/types.ts`, `core/sync.ts`) как вход для `computeBreathSync()`. Монтаж и props провайдера — **`modules/breath/ui/CoherenceBreathScreen.tsx`** (роут `app/breath-coherence.tsx`): `practiceKind`, `durationMs`, `chakra`, `soundBed`, `plannedCycle`, `cycleStartMs`, `biofeedbackEnabled`. Пакет **`modules/practices/`** в `mandala-sound` не импортируется — связь документируется как **practices → внутренний код breath**. Launch param `soundBed` задаётся карточкой/`launchPractice` и читается роутами.

- **`bindu` (контракт мандалы в `modules/mandala/core`)**  
  `modules/mandala-sound/core/sync.ts` импортирует **`buildAudioContract()`** из `modules/mandala/core/bio.ts` и **`AudioBandTrigger`** из `modules/mandala/core/types.ts`; через них считаются `textureBrightness`, гейны дорожек, **`flickerHz`** (равен `targetHz` из таймлайна), **`flickerIntensity`** и `gongTrigger`. Пакет **`mandala-sound` не импортирует** React-канвасы bindu — мандала получает уже готовый `MandalaSoundVisualSync` снаружи (см. §2).

- **`i18n` (локализованное имя приложения для lock-screen карточки)**  
  `modules/mandala-sound/ui/MandalaSoundProvider.tsx` импортирует `useAppLocale` и `getAppDisplayName` из `@/modules/i18n`. `getAppDisplayName(locale)` отдаёт локализованное имя приложения (RU «Гармонизатор», EN «Harmonizer» …) — это `artist` media-notification / lock-screen карточки. Runtime-зеркало build-time `APP_NAMES` из `plugins/appLocalesData.js`; при добавлении языка обновляются оба файла (см. `docs/02_modules/i18n/spec.md` §6). `useAppLocale().locale` — единственный источник активной локали; `locale` входит в dep-массив audio-lifecycle effect-а, поэтому карточка перебиндится при смене языка профиля.

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
