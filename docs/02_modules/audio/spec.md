---
id: 02_modules/audio/spec
title: Audio Spec
version: 1.4
updated: 2026-08-23
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/biofeedback/spec, 02_modules/bindu/spec, 02_modules/infra/spec]
code_refs: [modules/mandala-sound/index.ts, modules/mandala-sound/core/engine.ts, modules/mandala-sound/core/ambientEngine.ts, modules/mandala-sound/core/soundBed.ts, modules/mandala-sound/core/sync.ts, modules/mandala-sound/core/timeline.ts, modules/mandala-sound/ui/MandalaSoundProvider.tsx, scripts/build-ambient-loops.mjs]
---

## 1. Назначение

`audio` добавляет к активной практике тихий адаптивный звуковой слой и держит его в одном ритме с визуальным Bindu-контуром. Модуль не является отдельным экраном: он монтируется внутри дыхательной и медитативной сессии, собирает sync-кадр из таймлайна, дыхания и beat-событий, затем обновляет `expo-audio` loops и отдаёт visual sync наружу. Выбор фона взаимоисключающий: **Neuro-sync** (текущий binaural/drone-стек) или один из **8 nature ambient beds**.

## 2. Публичный контракт

- `MANDALA_SOUND_ASSETS: MandalaSoundAssetPreset`  
  Манифест локальных ассетов: `drones`, `textures`, `binaural`, `gongs`.
- `AMBIENT_SOUND_ASSETS` / `MANDALA_SOUND_ASSETS` — локальные `require()` в `core/ambientAssets.ts` / `core/assets.ts` (не реэкспорт из barrel). Tab UI (`PracticeCard`) импортирует только `core/soundBed`, иначе Dev Client качает ~24MB аудио при каждом QR-старте.
- `SOUND_BED_*` / `parseSoundBedId` / `isNatureSoundBedId` — id фона; AAC-лупы подключаются только при монтировании `MandalaSoundProvider`.
- `class ExpoMandalaSoundEngine implements MandalaSoundEngineControls`  
  `start(chakra: number): Promise<void>`  
  `update(frame: MandalaSoundSyncFrame): Promise<void>`  
  `stop(options?: { fadeOutMs?: number }): Promise<void>`
- `class AmbientLoopEngine`  
  `start(bedId, options?: { fadeInMs?; targetVolume? }): Promise<void>`  
  `stop(options?: { fadeOutMs? }): Promise<void>` — один зацикленный ambient с runtime fade.
- `buildMandalaSoundFrame(args: { startedAtMs: number; nowMs: number; durationMs: number; plannedCycle?: PlannedCycle | null; cycleStartMs?: number | null; lastBeat?: BeatEvent | null; lastRrMs?: number | null; previousTargetHz?: number | null; hueMain?: number; zoomVelocity?: number }): MandalaSoundSyncFrame`
- `computeBreathSync(plannedCycle: PlannedCycle | null | undefined, cycleStartMs: number | null | undefined, nowMs: number): MandalaSoundBreathSync`
- `computePulseSync(args: { lastBeat?: BeatEvent | null; lastRrMs?: number | null; nowMs: number }): MandalaSoundPulseSync`
- `detectGongCrossing(previousHz: number | null, currentHz: number): AudioBandTrigger["id"] | null`
- `SCHUMANN_RESONANCE_HZ = 7.83`
- `binauralCrossfadeGains(targetHz: number, binauralBeats: readonly number[]): number[]`
- `getMandalaSoundTargetHz(elapsedMs: number, durationMs: number): number`
- `getMandalaSoundEndHz(minutes: number): number`
- `getMandalaSoundBand(targetHz: number): MandalaSoundBand`
- `MANDALA_SOUND_START_HZ`, `MANDALA_SOUND_MIN_TARGET_HZ`, `MANDALA_SOUND_MAX_TARGET_HZ`
- `MandalaSoundProvider(props: PropsWithChildren<MandalaSoundSessionInput & { biofeedbackEnabled?: boolean }>)` — опциональный `soundBed` (default `neuro-sync`).
- `useMandalaSoundFrame(): MandalaSoundSyncFrame`
- `useMandalaSoundSync(): MandalaSoundVisualSync`
- `useMandalaSoundInterruption(): boolean` — `true`, пока ОС приостановила наш аудио (звонок, другое приложение захватило audio focus). Потребители (например `CalmPracticeScreen`) палят по этому флагу учёт elapsed-времени, чтобы практика завершалась ровно через заданную длительность, а не «съедала» время паузы.
- Экспортируемые типы: `MandalaSoundAssetPreset`, `MandalaSoundBinauralLoop`, `MandalaSoundBand`, `MandalaSoundBreathSync`, `MandalaSoundEngineControls`, `MandalaSoundLockScreen`, `MandalaSoundPracticeKind`, `MandalaSoundPulseSync`, `MandalaSoundSessionInput`, `MandalaSoundSyncFrame`, `MandalaSoundVisualSync`, `SoundBedId`, `NatureSoundBedId`.

## 3. Внутренняя архитектура

- `MandalaSoundProvider` — **мастер тактового контура** сессии: при `isActive` держит `startedAtMs`, `previousTargetHz`, локальный beat/RR state и раз в **`CONTROL_TICK_MS` (250 ms)** вызывает `buildMandalaSoundFrame` → обновляет контекст и (только для `neuro-sync`) `ExpoMandalaSoundEngine.update(frame)`; отсюда же берутся `flickerHz` / `flickerIntensity` для мандалы. При nature bed визуальный sync остаётся, binaural-стек не стартует — играет `AmbientLoopEngine`. Fade-in ~0.6 s при старте, fade-out ~0.8 s при `isActive=false` / unmount / смене bed.
- `core/timeline.ts` переводит прогресс практики в целевой brainwave диапазон по сигмоидальной модели: старт в альфа (12 Гц), финиш `f_end(T)` от альфа (короткие) до дельта (длинные); band определяется порогами `beta/alpha/theta/delta`.
- `core/sync.ts` собирает sync-кадр: дыхание берётся из `PlannedCycle` (тип и план из сценария **дыхательной практики**, код — `modules/breath/core/breath-phase-planner.ts` внутри **practices**), пульс из `BeatEvent` с fallback на LFO, затем через `buildAudioContract()` из Bindu-контракта вычисляются `textureBrightness`, `droneGain`, `textureGain`, `binauralGain`, `flickerHz`, `flickerIntensity` и `gongTrigger`.
- `ExpoMandalaSoundEngine` не синтезирует звук на лету. Он заранее загружает loops через `expo-audio` (`createAudioPlayer`), держит громкости почти на нуле и на каждом тике обновляет `drone`, две `texture`-дорожки и binaural-кроссфейд по `targetHz` (чистая функция `binauralCrossfadeGains` из `core/binaural.ts`); `gongs` играются как best-effort one-shot по `gongTrigger`. Случайные «события» (Punctual Events) удалены — остались только два намеренных переходных гонга.
- **Фоновое воспроизведение (Android 14+).** `expo-audio` с config-плагином `enableBackgroundPlayback: true` добавляет в `AndroidManifest` foreground service `AudioControlsService` (тип `mediaPlayback`) + permissions `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK`. Для длительного фонового звука (часы) на Android **обязателен** вызов `player.setActiveForLockScreen(true, metadata)` — без него ОС останавливает аудио примерно через 3 минуты в Doze (platform limitation, см. docs expo-audio). `MandalaSoundProvider` при `staysActiveInBackground + lockScreen` резолвит обложку в локальный `file://` URI (`resolveLocalArtworkUri` через `expo-asset`) и передаёт в движок; движок bindит lock-screen на lead-плеере (drone для neuro-sync, активный буфер для ambient с ре-биндингом на handoff). `interruptionMode: "doNotMix"` — обязательно для `setActiveForLockScreen` и означает, что медитация становится единственным аудио (чужое приложение ставится на паузу). Для не-фоновых практик (breath/Flash) используется `"duckOthers"` — bed слышно, но чужое аудио не останавливается полностью.
- **Interruption handling.** Движки пробрасывают `onPlaybackStateChange(playing)` из `playbackStatusUpdate` lead-плеера: пока мы сами никогда не pause-им bed, `playing=false` = внешнее прерывание (звонок / чужое приложение), `playing=true` = фокус вернулся и система resume-нула. `MandalaSoundProvider` кладёт это в контекст как `interrupted`; `CalmPracticeScreen` по флагу исключает окно прерывания из elapsed-таймера (сдвиг `sessionStartedAtRef` вперёд на длительность паузы) — практика завершается ровно через заданную длительность, а не «съедает» время звонка.
- Визуальный слой получает только `MandalaSoundVisualSync` через `useMandalaSoundSync()`. Так дыхательная мандала и `BinduSuccessionFlowCanvas` мерцают в том же диапазоне, что и звук.

## 4. Конфигурация и параметры

- Внешние входы провайдера: `practiceKind: "breath" | "meditation"`, `durationMs`, `chakra`, `isActive`, `plannedCycle`, `cycleStartMs`, `biofeedbackEnabled`, **`soundBed`** (`neuro-sync` | `creek` | `waves` | `rain` | `forest_birds` | `wind` | `fireplace` | `water_splash` | `cat_purr`), **`staysActiveInBackground`** (фоновое воспроизведение для «Спокойствие»), **`lockScreen`** (`{ title, artwork }` — карта media-notification / lock-screen: локализованное название практики + `require()`'d обложка; bindится только вместе с `staysActiveInBackground`).
- Nature beds — бесшовные AAC в `assets/audio/ambient/<id>.m4a` (4 s baked acrossfade через `scripts/build-ambient-loops.mjs` + `sources.json`); сырые исходники в `assets/audio/ambient/raw/` не бандлятся (gitignored).
- Выбор чакры влияет на `drone` и пару `texture`-лупов (только Neuro-sync). Сейчас доступны `7` drone-ассетов по чакрам и `3` texture-лупа с циклическим выбором пары.
- Таймлайн (единый для звука и мерцания мандалы) — **сигмоидальная адаптивная модель** `f(t) = f_end + (f_start − f_end) / (1 + exp(k·(t − t_mid)))` с `f_start = 12 Гц`, `t_mid = 0.45·T`, `k = 7/T`:
  - стартовая `f(0) ≈ 12 Гц` (верхняя граница альфа, безопасна по фотосенситивности — потолок `MANDALA_SOUND_MAX_TARGET_HZ = 13 Гц` исключает бета-диапазон);
  - целевая `f_end(T_min)` — кусочно-линейная функция длительности (`getMandalaSoundEndHz`): `1 мин → 11`, `3 → 8`, `5 → 6`, `8 → 4.5`, `10 → 3.5`, `15 → 2.75`, `20 → 2 Гц`, пол `2 Гц`;
  - три фазы: Catch (плавный старт) → Glide (основное снижение в середине) → Hold (плато у цели); монотонно убывает; пиковая скорость сброса в `t_mid` — от ~2.3 Гц/мин (3 мин) до ~0.88 Гц/мин (20 мин).
- Binaural слой — **мультиполосный кроссфейд**: `12` предзаписанных loop'ов с частотами биения `12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2 Гц` (несущая фиксирована `150 Гц`, `L = 150 − b/2`, `R = 150 + b/2`). На каждом тике `binauralCrossfadeGains(targetHz, beats)` выбирает два соседних loop'а, между которыми лежит `targetHz`, и интерполирует их громкости (сумма активных gain'ов = 1) — бит «скользит» вслед за сигмоидой с шагом ~1 Гц + кроссфейд вместо 4 дискретных полос. `band` (пороги `<4 delta / <8 theta / <13 alpha / ≥13 beta`) сохранён в кадре для диагностики. `gongTrigger` — только при пересечении двух порогов: `7.83 Гц` (резонанс Шумана, альфа→тета → средний гонг) и `4 Гц` (тета→дельта → большой гонг); на коротких сессиях, не доходящих до порога, гонг не играется. Случайные Punctual Events удалены.
- Глубина мерцания `flickerIntensity` плавно затухает к концу сессии (множитель `1 − 0.4·progress`) — адаптация зрительной системы к темноте; дыхание/пульс по-прежнему модулируют базовую амплитуду.
- Внутренние runtime-настройки зашиты в код: `CONTROL_TICK_MS = 250`, pulse fallback включается после `2200 ms` без beat-события.

## 5. Известные ограничения

- Движок основан на `expo-audio` (`AudioPlayer` volume control, `createAudioPlayer`), а не на AudioWorklet/JSI DSP. Binaural-слой теперь **мультиполосный кроссфейд** из 12 loop'ов (шаг ~1 Гц, несущая 150 Гц) — бит следует за `targetHz` почти непрерывно. Полностью непрерывный per-ear осциллятор с медленной модуляцией несущей 140–180 Гц не реализован: для него нужен нативный синтез (`react-native-audio-api`), а он на Expo SDK 54 конфликтует с `react-native-worklets` 0.5.1 (Issue #739) — блокирует до обновления SDK.
- `expo-av` остаётся в проекте только для записи микрофона (Communicator / whisper / affirmations); движки `mandala-sound` полностью перешли на `expo-audio`.
- Историческое ТЗ про `70` текстур, `20` событий и live-фильтры не соответствует текущему коду: сейчас в рантайме `7` drones, `3` textures, `12` binaural loops и `3` gongs. Случайные Punctual Events удалены (2026-07-05) — остались только два намеренных переходных гонга (Шуман 7.83 Гц + 4 Гц).
- Эффект binaural beats практически требует наушников; через динамик телефона каналы смешиваются.
- Провайдер жёстко связан с контрактами **`modules/mandala/core`** (`buildAudioContract`, `AudioBandTrigger`) и с типом **`PlannedCycle`** из **`modules/breath/core/breath-phase-planner.ts`** (внутренняя реализация **дыхательной практики** в составе **practices**). Любые изменения этих типов меняют поведение `audio`.
- При перегрузке JS-потока `ExpoMandalaSoundEngine` пропускает overlapping updates вместо очереди. Это защищает практику от накопления лагов, но делает звуковую модуляцию менее точной на слабых устройствах.
- Отдельной web-адаптации нет: код ориентирован на Expo/RN runtime. Если нативный audio backend отказывает, visual sync продолжает работать, но звук остаётся отключённым.
## Справочные материалы

- docs/04_reference/audio/ibaa_layered_audio.md
- docs/04_reference/audio/trance_protocol.md
- Исследование «Алгоритм светозвуковой стимуляции мозга» (сигмоидальная адаптивная модель, таблица `f_end(T)`) — источник текущей формулы `getMandalaSoundTargetHz`.
