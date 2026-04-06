# MANDALA_VISUAL_CORE

Единый модуль генератора видео-медитаций для React Native / Expo: `Skia`-визуализация, runtime-состояние в `SharedValues`, `BioSim` для fail-safe анимации и debug-песочница для ручной настройки пресетов. Подробная спецификация: [`docs/meditation_video_generator_spec.md`](../../docs/meditation_video_generator_spec.md).

## Назначение

Модуль решает первую фазу второй части приложения:

- собирает `Preset JSON` в единый runtime-контракт;
- переносит параметры в `SharedValues`;
- рендерит процедурную мандалу на `Skia`;
- отделяет базовый ритм пресета от био-модуляции через `bio_weight`;
- предоставляет sandbox-экран для отладки топологий, sacred-пресетов, кинетики, художественных рецептов и биосимуляции.

## Интерфейсы

### Inputs

- `MeditationPresetScenario` / `MeditationPresetKeyframe` из `core/types.ts`
- `BioSignalFrame` из `core/types.ts`
- `BioSimConfig` для fail-safe режима
- `MandalaArtDirectionState` для художественных рецептов (`Lotus Bloom`, `Tunnel Bloom`, `Yantra Pulse`, `Fractal Bloom`, `Metatron Portal`)

### Outputs

- `MandalaSessionState` как runtime-слой с данными для `SharedValues`
- `MandalaCanvas` для `Skia`-рендера
- `MandalaSandboxScreen` для dev/debug настройки
- `MandalaAudioContract` как будущий контракт для аудио-модуля следующей фазы

## Внешние зависимости

- `@shopify/react-native-skia`
- `react-native-reanimated`
- `react-native-safe-area-context`

## Логика работы

1. `Preset JSON` санитизируется и нормализуется.
2. `useMandalaSession()` переносит активный keyframe в `SharedValues` и синхронизирует runtime-состояние.
3. `BioSim` генерирует `breathPhase`, `pulsePhase`, `hrv`, `stressIndex`, если реальный биосенсор не подключен.
4. `MandalaCanvas` объединяет базовые параметры пресета и live-биомодуляцию в `Skia` shader uniforms.
5. `MandalaSandboxScreen` позволяет менять параметры вручную и сразу применять их в runtime.

## Слой развития образа

Для режима `Evolving` модуль теперь разделяет:

- общий shader-блок органической эволюции в `ui/evolution-shader.ts`;
- TS-side реестр evolution-блоков в `ui/evolution-registry.ts`;
- fallback-блок для неподключенных образов в `ui/default-evolution-shader.ts`;
- recipe-специфичный блок развития `Lotus Bloom` в `ui/lotus-bloom-evolution-shader.ts`;
- основной `MandalaCanvas`, который остается точкой сборки итогового shader source и runtime uniforms.

Такой разрез позволяет переиспользовать low-frequency noise, growth-envelope и morph scheduler для других `visualRecipe`, не смешивая общий механизм развития с геометрией конкретного образа. `MandalaCanvas` теперь запрашивает evolution-блок через реестр по `visualRecipe`, а не зависит напрямую от конкретного образа.

Для экспериментов с `Lotus Bloom` художественный слой также поддерживает:

- `petalProfile`: набор архетипов лепестков (`teardrop`, `almond`, `lotusSpear`, `roundedSpoon`, `flame`, `heartPetal`, `splitPetal`, `oval`);
- `evolutionProfile`: сценарии развития (`rebirth`, `spiralDrift`, `tidalBreath`, `haloCascade`).

Это позволяет исследовать не только численные параметры, но и более высокоуровневые типы формы и роста внутри одного и того же runtime-контракта.

## План развития

- Подключить `BiofeedbackSensorAdapter` для камеры/PPG без изменения контракта `BioSignalFrame`.
- Добавить `MandalaTranslator`, который будет переводить психологический запрос в пресет.
- Реализовать `MandalaAudioEngine` как отдельную фазу поверх уже готового `MandalaAudioContract`.
- Вынести следующие recipe-блоки развития (`Tunnel Bloom`, `Yantra Pulse`, `Fractal Bloom`, `Metatron Portal`) на тот же reusable evolution-layer.
- Добавить stateful feedback-контур для мягких cellular automata и орнаментального фрактального роста поверх текущего one-pass shader.
