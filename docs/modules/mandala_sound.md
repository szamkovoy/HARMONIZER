# Mandala Sound

Mandala Sound — дополнительный слой практики, а не самостоятельный режим. Он синхронизирует тихий аудио-фон, редкие якоря переходов и мерцание мандалы с тем же таймлайном.

## Runtime Flow

1. Экран практики монтирует `MandalaSoundProvider`.
2. Provider строит `MandalaSoundSyncFrame` каждые 100 ms.
3. Для дыхания frame использует `plannedCycle` и `cycleStartMs`; для медитации — только session timeline.
4. `expo-av` engine обновляет громкость drone/texture/binaural layers и проигрывает gong при входе в alpha/theta/delta.
5. `useMandalaSoundSync()` передаёт `flickerHz` и `flickerIntensity` в Bindu canvas.

## Why This Shape

Дыхательная практика уже сочетает камеру, пульсометр, вычисление RSA и Skia. Поэтому v1 выбирает 80/20-решение: аудио воспринимается как живое за счёт дыхательной громкости, мягкой пульсации, реального stereo binaural layer и редких якорей, но не требует постоянного DSP в JS.

## Binaural Layer

В `assets/audio/mandala-sound/binaural/` лежат stereo loops. В каждом файле левый канал — carrier 180 Hz, правый канал — carrier плюс целевой delta:

- `beta.wav`: 16 Hz;
- `alpha.wav`: 10 Hz;
- `theta.wav`: 6 Hz;
- `delta.wav`: 2.5 Hz.

Engine держит эти loops на нулевой громкости и мягко поднимает только loop текущего `band`. Для perceptual-теста нужны наушники: через динамик телефона каналы смешиваются, и binaural beat почти теряет смысл.

## Integration Points

- `modules/breath/ui/CoherenceBreathScreen.tsx`: breath + biometrics integration.
- `modules/mandala/experiments/SacredSymbolStreamScreen.tsx`: meditation integration.
- `modules/breath/ui/BreathBinduMandala.tsx`: passes visual sync into Bindu lab canvas.
- `modules/mandala/experiments/BinduSuccessionLabCanvas.tsx`: cloud flicker sync.
- `modules/mandala/experiments/BinduSuccessionFlowCanvas.tsx`: meditation flow flicker sync.
