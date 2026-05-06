---
id: 02_modules/audio/history
title: Audio History
version: 1.1
updated: 2026-05-06
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/biofeedback/spec, 02_modules/bindu/spec, 02_modules/infra/spec]
code_refs: [modules/mandala-sound/index.ts, modules/mandala-sound/core/engine.ts, modules/mandala-sound/core/sync.ts, modules/mandala-sound/core/timeline.ts, modules/mandala-sound/ui/MandalaSoundProvider.tsx]
---

## Decision Log

- **2026-05:** `Mandala Sound` введён как встраиваемый слой практики, а не как отдельный режим. Почему: звук должен жить внутри уже существующих breath/meditation flows и использовать тот же session timeline, что и визуальный Bindu-контур. Что изменилось: появились `MandalaSoundProvider`, `useMandalaSoundSync()` и интеграции в `CoherenceBreathScreen` и `SacredSymbolStreamScreen`.

- **2026-05:** Для v1 выбран `expo-av` loop-based движок вместо AudioWorklet/JSI DSP из старого текстового ТЗ. Почему: текущий Expo/RN runtime уже нагружен камерой, PPG pipeline и Skia, поэтому приоритет сместился к предсказуемому low-risk playback. Что изменилось: `ExpoMandalaSoundEngine` управляет только готовыми loops/one-shots и меняет громкости, а историческое ожидание про live-фильтры, `70` текстур и `20` событий не подтверждается текущим кодом.

- **2026-05:** Добавлен дискретный binaural слой по диапазонам `beta/alpha/theta/delta` и привязка gong-якорей к входу в band. Почему: нужно было дать слышимую brainwave-динамику без непрерывного синтеза по каналам. Что изменилось: в ассетах появились `binaural/*.wav`, `gongs/*.wav`, а `core/timeline.ts` + `core/sync.ts` начали определять `band`, `targetHz` и `gongTrigger`.

- **2026-05:** Звук стал источником синхронизации для Bindu-канвасов, а не только фоном. Почему: визуальное мерцание и аудио-band должны ощущаться как один процесс. Что изменилось: `useMandalaSoundSync()` начал передавать `flickerHz/flickerIntensity` в `BreathBinduMandala`, `BinduSuccessionLabCanvas` и `BinduSuccessionFlowCanvas`.

- **2026-05:** В движок и провайдер добавлены runtime diagnostics и защита от overlapping updates. Почему: при длинной дыхательной практике JS-thread может перегружаться, и накопление аудиокоманд хуже, чем пропуск редких тиков. Что изменилось: `engine.ts` ведёт `updateInFlight/skippedUpdates`, пишет lifecycle-события в `runtimeDiagnostics`, а визуальный sync продолжает жить даже при отказе audio backend.
