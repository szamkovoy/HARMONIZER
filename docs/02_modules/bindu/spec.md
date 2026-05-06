---
id: 02_modules/bindu/spec
title: Bindu Spec
version: 1.1
updated: 2026-05-06
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/audio/spec, 02_modules/biofeedback/spec]
code_refs: [modules/mandala/ui/MandalaCanvas.tsx, modules/mandala/ui/evolution-registry.ts, modules/mandala/experiments/BinduSuccessionLabCanvas.tsx, modules/breath/ui/BreathBinduMandala.tsx, app/mandala-sandbox.tsx, app/bindu-succession-lab.tsx, app/sacred-symbol-stream.tsx]
---

## 1. Назначение

Модуль **bindu** в документации соответствует пакету `modules/mandala/`: процедурная визуализация мандалы в React Native через `@shopify/react-native-skia` (runtime shader + состояние сессии). Он даёт единый визуальный контур для отладочной песочницы, лабораторных веток и дыхательной практики (через обёртку в `modules/breath`). Цель в runtime — синтезировать форму, цвет, сакральные пресеты и живую модуляцию из сценария (`MandalaSessionState`) и сигнала тела (`BioSignalFrame` / аудио-синхронизация), без отдельного «генератора» и «шейдера» как двух несвязанных сервисов.

## 2. Публичный контракт

Ниже — то, чем реально пользуются соседние модули и экраны (глубокие импорты из `modules/mandala/...` и `modules/breath/...`; отдельного barrel-экспорта нет).

- **`MandalaCanvas`** (`modules/mandala/ui/MandalaCanvas.tsx`)  
  `MandalaCanvas({ sessionState, bioFrame, isActive?, renderMode? })` — полноэкранный Skia `RuntimeEffect`, до четырёх слоёв `Fill`+`Shader` с униформами из `buildLayerUniforms`.  
  Экспорт типов: `MandalaCanvasProps`, **`RenderMode`**: `"static" | "evolving"`.

- **`getEvolutionShaderBlock`** (`modules/mandala/ui/evolution-registry.ts`)  
  `getEvolutionShaderBlock(recipe: VisualRecipe): string` — выбор блока GLSL эволюции по `VisualRecipe` (`lotusBloom` использует отдельный блок из `lotus-bloom-evolution-shader.ts`, остальные рецепты — `default-evolution-shader.ts`).

- **Типы и контракты сессии** (`modules/mandala/core/types.ts`, импортируются `audio`, `biofeedback`, `breath`, `mandala-sound`):  
  - **`BioSignalFrame`**, **`BioSignalSource`** — фаза дыхания, пульс, RMSSD, stress, качество сигнала; общий DTO для визуала и адаптера биофидбека.  
  - **`MandalaSessionState`**, **`MandalaGeometryState`**, **`MandalaPrimitiveState`**, **`MandalaComplexityState`**, **`MandalaImperfectionState`**, **`MandalaAppearanceState`**, **`MandalaModulationState`**, **`MandalaKineticsState`**, **`MandalaArtDirectionState`**, **`BioWeightMap`** — полный снимок параметров для шейдера.  
  - **`MeditationPresetScenario`**, **`MeditationPresetKeyframe`** — JSON-ориентированный сценарий медитации.  
  - **`VisualRecipe`**, **`RevealMode`**, **`PalettePreset`**, **`PetalProfile`**, **`EvolutionProfile`**, **`TopologyType`** и др. — перечисления, пробрасываемые в униформы.  
  - **`MandalaAudioContract`**, **`AudioBandTrigger`** — связка с частотным/гонг-контуром; читает **`buildAudioContract()`** из `modules/mandala/core/bio.ts` модуль `mandala-sound`.

- **`useMandalaSession`** (`modules/mandala/store/useMandalaSession.ts`)  
  Хранит и обновляет `MandalaSessionState` по сценарию; используется песочницей.

- **Пресеты и рецепты** (`modules/mandala/core/defaults.ts`, `modules/mandala/core/recipes.ts`, `modules/mandala/core/preset.ts`)  
  `DEFAULT_SCENARIO`, сборка keyframe, `sanitizeKeyframe` / `sanitizeScenario`, **`getRecipeById`**, **`MANDALA_RECIPES`** — подготовка данных для `MandalaCanvas` и смежных экранов.

- **`BinduSuccessionLabCanvas`** (`modules/mandala/experiments/BinduSuccessionLabCanvas.tsx`)  
  Отдельный конвейер «CPU geometry → stack оболочек → shader ornament»: props включают `isActive`, `visualPreset` (`ChakraVisualPreset` из `binduSuccessionVisualPresets.ts`), `externalSync?: MandalaSoundVisualSync`, `showMandala`, `targetFps`, `flowSpeed`, `sessionSeed`, `sceneOffset`, `densityBias`, `debugGeometry`, `onRenderCommitted`. Используется лабораторией и продакшен-дыханием.

- **`BreathBinduMandala`** (`modules/breath/ui/BreathBinduMandala.tsx`)  
  `memo`-обёртка над `BinduSuccessionLabCanvas` с дефолтным chakra-пресетом и опциональным `externalSync` из `MandalaSoundProvider`.

Маршруты приложения: **`app/mandala-sandbox.tsx`** → `MandalaSandboxScreen`; **`app/bindu-succession-lab.tsx`** → `BinduSuccessionLabScreen`; **`app/sacred-symbol-stream.tsx`** → поток с `BinduSuccessionFlowCanvas` и опционально `MandalaSoundProvider`.

## 3. Внутренняя архитектура

- **`MandalaCanvas`** собирает исходник шейдера: базовый GLSL из файла (топологии, sacred presets, lotus field, рецепты, reveal, bio-uniforms) + общий блок `EVOLUTION_SHADER_SHARED_BLOCK` + динамический фрагмент из **`getEvolutionShaderBlock`**. Компиляция через `Skia.RuntimeEffect.Make`; при ошибке — throw. Время для анимации — локальный `setInterval` ~30 Hz, пока `isActive`.

- **Два визуальных поколения в одном репозитории**: (1) монолитный шейдерный рантайм `MandalaCanvas` + сессия из keyframes; (2) лабораторный/alternate pipeline succession/tube в `experiments/*` с собственными шейдерами и CPU-стеком оболочек. Они намеренно разделены: старый документ лаборатории подчёркивал, что лаборатория не меняет контракт основного `MandalaCanvas`.

- **`evolution-registry`** — тонкая таблица соответствия `VisualRecipe` → строка GLSL, чтобы не тащить тяжёлый lotus-блок в рецепты, где достаточно дефолтной эволюции.

## 4. Конфигурация и параметры

- **Сценарий и keyframes** — числовые поля геометрии, кинетики, арт-дирекшна (в т.ч. `visualRecipe`, `layerCount`, `evolutionProfile`, веса био-модуляции `bioWeights`).

- **`RenderMode`** — `static` отключает ветку `evolvingPattern` в шейдере, `evolving` включает warp/lifecycle слоёв для `visualRecipe === lotusBloom` и др.

- **Лаборатория Bindu succession** — typed пресеты цветов (`DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS`), опциональная персистенция JSON в `documentDirectory` (`bindu-succession-lab-visual-presets.json`), скорость трубы `TUBE_FLOW_SPEED`, выбор чакры, редактор hex/swatch.

- **Песочница `MandalaSandboxScreen`** — фокус на рецепте `lotusBloom`; **`bioFrame`** в коде сейчас константа с `source: "offline"` и комментарием об отключённом био-влиянии при настройке «чистого» визуала.

## 5. Известные ограничения

- Крупный inline-шейдер в `MandalaCanvas.tsx` — высокая стоимость сопровождения и компиляции; ошибки ловятся только в runtime при `Make`.

- Платформа: только Skia/React Native; web-parity нет.

- Два пайплайна (canvas vs succession lab) дублируют идею «мандалы»; перенос фич между ними ручной.

- Полная интеграция живого `BioSignalFrame` из `MandalaBioFrameAdapter` в песочнице не показана — там зафиксирован offline-фрейм; продакшен-дыхание опирается на аудио-синхронизацию и отдельный canvas.
