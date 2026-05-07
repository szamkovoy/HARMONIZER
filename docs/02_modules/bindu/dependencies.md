---
id: 02_modules/bindu/dependencies
title: Bindu Dependencies
version: 1.3
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/audio/spec, 02_modules/biofeedback/spec]
code_refs: [modules/mandala/ui/MandalaCanvas.tsx, modules/mandala/ui/evolution-registry.ts, modules/mandala/experiments/BinduSuccessionLabCanvas.tsx, modules/breath/ui/BreathBinduMandala.tsx, app/mandala-sandbox.tsx, app/bindu-succession-lab.tsx, app/sacred-symbol-stream.tsx]
---

## 1. Зависит от

- **`infra`**  
  `MandalaCanvas` и экспериментальные канвасы зависят от Expo/React Native, Skia и системного layout (`onLayout` для resolution uniforms).  
  `BinduSuccessionLabScreen` использует `expo-file-system/legacy` (`documentDirectory`, `readAsStringAsync`, `writeAsStringAsync`) для локальных override визуальных пресетов.  
  `AppState`, фокус навигации (`useIsFocused`) и Safe Area управляют жизненным циклом рендера и тиков.

- **`audio`** (`modules/mandala-sound`, в основном **типы** и композиция)  
  Тип **`MandalaSoundVisualSync`** импортируется в `BinduSuccessionLabCanvas.tsx`, `BinduSuccessionFlowCanvas.tsx` (проп `externalSync`) — без подписки на тики изнутри канваса.  
  `modules/mandala/experiments/SacredSymbolStreamScreen.tsx` **рантаймом** импортирует `MandalaSoundProvider` и `useMandalaSoundSync()` из `@/modules/mandala-sound` (экспериментальный экран внутри пакета `mandala`).  
  **Обратное направление кода:** `modules/mandala-sound/core/sync.ts` импортирует **`buildAudioContract`** / типы из **`modules/mandala/core`** — это зафиксировано в `docs/02_modules/audio/dependencies.md` §1 как зависимость **`audio` → bindu (mandala core)**, а не наоборот.

## 2. От него зависят

- **`practices`**  
  Поток когерентного дыхания: `app/breath-coherence.tsx` рендерит `CoherenceBreathScreen`, который подключает **`BreathBinduMandala`** → внутри тот же **`BinduSuccessionLabCanvas`**, что и в лаборатории, с пресетом чакры и `externalSync` из `useMandalaSoundSync()`. Практика не импортирует `MandalaCanvas` напрямую; визуальный bindu-контур идёт через слой `breath`.

- **`biofeedback`**  
  `modules/biofeedback/adapters/MandalaBioFrameAdapter.ts` импортирует тип **`BioSignalFrame`** (и косвенно контракт полей) из `modules/mandala/core/types.ts`, чтобы публиковать в мандалу согласованный снимок с шины. Сам пакет `modules/mandala` **не** импортирует `modules/biofeedback`; связь направлена от адаптера к типам bindu и к будущим/альтернативным потребителям `BioSignalFrame`. Парная запись потребителя — `docs/02_modules/biofeedback/dependencies.md`.

- **`audio`**  
  `mandala-sound` — потребитель **`modules/mandala/core/bio.ts`** и типов мандалы для одного числового контура (звук + `flickerHz`). Канвасы bindu либо получают готовый `MandalaSoundVisualSync` снаружи, либо монтируют `MandalaSoundProvider` в экспериментах — см. `02_modules/audio/dependencies.md` §1–2.

## 3. Контрактные точки риска

- **`BioSignalFrame`** и семантика фаз/частот — общий контракт между адаптером биофидбека, шейдером `MandalaCanvas` и логикой `core/bio.ts`; изменение полей без синхронного обновления `MandalaBioFrameAdapter` и `buildMandalaSoundFrame` даёт тихий визуальный/звуковой рассинхрон.

- **`MandalaSoundVisualSync`** минимален; `BinduSuccessionLabCanvas` опирается на flicker-поля. Расширение типа в `mandala-sound` затронет все канвасы с `externalSync`.

- **`VisualRecipe` → shader block** в `evolution-registry.ts`: новый рецепт без записи в `EVOLUTION_SHADER_BLOCKS` падает в default; визуально «сломается» только эволюция, без compile-time ошибки.

- **Персистентные пресеты лаборатории** — JSON на диске; формат `ChakraVisualPreset` задаётся `sanitizeChakraVisualPresets`; несовместимое изменение типа может обнулить или исказить цвета после обновления приложения.

- **Дублирование пайплайнов** — правка только `MandalaCanvas` не меняет succession-lab и наоборот; продуктовые сценарии могут разойтись по поведению.
