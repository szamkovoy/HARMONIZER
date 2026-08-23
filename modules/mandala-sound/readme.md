# Mandala Sound

Лёгкий дополняющий аудио-слой для медитаций и дыхательных практик.

## V1 contract

- `core/timeline.ts` переводит длительность практики в плавный brainwave target: beta → alpha → theta → delta. Короткие практики не загоняются в delta.
- `core/sync.ts` собирает `MandalaSoundSyncFrame`: дыхание, пульс, целевая частота мерцания, громкости слоёв и gong trigger.
- `ui/MandalaSoundProvider.tsx` запускает `expo-audio` loops только во время активной практики и обновляет параметры с частотой 10 Hz.
- `core/assets.ts` подключает настоящий stereo binaural layer: левый и правый каналы имеют разницу `beta=16 Hz`, `alpha=10 Hz`, `theta=6 Hz`, `delta=2.5 Hz`.
- `useMandalaSoundSync()` отдаёт тот же sync в визуальный слой, чтобы облако/мандала мерцали в одном ритме со звуком.

## Performance choices

V1 намеренно не использует AudioWorklet, BiquadFilterNode или live oscillator DSP: в текущем Expo/RN стеке приложения их нет, а дыхательная практика уже нагружает телефон камерой, PPG pipeline и Skia. Вместо этого используются тихие локальные loops, предрендеренный binaural stereo layer, редкие one-shot события и мягкие volume ramps.

## Biometrics

В дыхательной практике provider читает `plannedCycle + cycleStartMs` как авторитетный источник дыхания и подписывается на `beat` через `useBiofeedbackSubscribe`, чтобы не вызывать re-render всего экрана. При пропаже beat-сигнала пульс плавно уходит в fallback LFO 1.1 Hz; дыхание без плана уходит в fallback LFO 0.33 Hz.

## Assets

Минимальные WAV-ассеты лежат в `assets/audio/mandala-sound/`:

- `drones/`: 7 чакральных drone loops;
- `textures/`: 3 мягкие текстуры;
- `binaural/`: 4 stereo loops для beta/alpha/theta/delta. Проверять лучше в наушниках;
- `gongs/`: alpha/theta/delta anchors;
- `events/`: редкие мягкие события.

Полная библиотека из старого ТЗ может быть добавлена позже через расширение manifest-а без изменения контракта.

## V2 direction

Следующий шаг — native-аудио фаза с continuous per-ear oscillator, чтобы `targetHz` менялся не только по диапазонам, а плавно на каждом участке timeline. Текущая версия уже даёт реальный binaural beat, но дискретно по band loops.
