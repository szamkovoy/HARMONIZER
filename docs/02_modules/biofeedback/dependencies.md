---
id: 02_modules/biofeedback/dependencies
title: Biofeedback Dependencies
version: 1.4
updated: 2026-06-28
depends_on: [01_foundation/architecture, 02_modules/practices/spec, 02_modules/audio/spec, 02_modules/bindu/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/biofeedback/bus/biofeedback-pipeline.ts,
    modules/biofeedback/bus/channels.ts,
    modules/biofeedback/adapters/MandalaBioFrameAdapter.ts,
    modules/biofeedback/wearables/BleHeartRateSource.tsx,
    modules/biofeedback/wearables/WearablePickerDialog.tsx,
    modules/biofeedback/wearables/preferences.ts,
    modules/breath/ui/CoherenceBreathScreen.tsx,
    modules/mandala-sound/ui/MandalaSoundProvider.tsx,
    modules/breath/ui/BreathBinduMandala.tsx,
    modules/biofeedback/core/metrics.ts,
    modules/biofeedback/core/signal-trust.ts,
    modules/biofeedback/core/rr-smoothing.ts,
    modules/biofeedback/engines/coherence-engine.ts,
    modules/biofeedback/engines/pulse-bpm-engine.ts,
    modules/biofeedback/engines/rsa-engine.ts,
  ]
---

## 1. Зависит от

- **`infra`**  
  Expo/React Native: `expo-camera`, torch, `expo-file-system` для экспорта сессий, `expo-keep-awake`, Reanimated, runtime diagnostics и BLE runtime `@sfourdrinier/react-native-ble-plx` (config plugin + native permissions в `app.config.ts`). Опционально нативный пакет `modules/biofeedback-finger-frame-processor` (JSI) — см. импорты в `CoherenceBreathScreen.tsx`.

- **`bindu` (типовой контракт)**  
  `MandalaBioFrameAdapter` импортирует `BioSignalFrame` из `modules/mandala/core/types.ts`. Слой mandala не импортирует biofeedback обратно; связь односторонняя от адаптера к типам визуализации.

- **Дыхательный домен (`modules/breath/*`, продуктово — `practices`)**  
  `CoherenceEngine` и `SessionExporter` импортируют константы, тахограмму и `runCoherenceSessionAnalysis` из `modules/breath/core/coherence-session-analysis.ts`, `coherence-constants.ts`, `tachogram-4hz.ts`. Обратная type-связь: `coherence-session-analysis.ts` импортирует `BiofeedbackSignalTrustSummary` из `modules/biofeedback/core/signal-trust.ts` (поле `signalTrust` в export debug). Экран `CoherenceBreathScreen` связывает pipeline, планировщик фаз, `getSignalTrustSummary()` / `getMetricBeatTimestamps()` и UI.

- **`subscription` (косвенно)**  
  Доступ к дыхательным практикам с камерой ограничен тарифами с флагом `breath_practices` (`modules/access/core/features.ts`); отдельного feature key для biofeedback нет.

## 2. От него зависят

- **`audio`**  
  `MandalaSoundProvider` — `useBiofeedbackSubscribe("beat", …)` и типы `BeatEvent`; см. `02_modules/audio/dependencies.md`.

- **`bindu`**  
  `BreathBinduMandala` использует снимок биосигнала через адаптер; в `02_modules/bindu/dependencies.md` перечислена зависимость адаптера от типов mandala.

- **`practices`**  
  `app/breath-coherence.tsx` → `CoherenceBreathScreen` монтирует весь pipeline и звук/мандалу; `PracticeCard.tsx` и `CoherenceBreathScreen` импортируют общий **`WearablePickerDialog`** + читают/save wearable preferences и передают в route `sensorMode`, device identity и capability tier. Debug parity bench: `app/biofeedback-parity.tsx` → `BiofeedbackParityScreen`. Парная запись: `docs/02_modules/practices/dependencies.md` §1.

## 3. Контрактные точки риска

- **Имена и семантика каналов `ChannelMap`** — любое переименование ломает подписчиков (`audio`, snapshot-adapter, адаптер мандалы).
- **`BeatEvent.source` и `confidence`** — влияют на `computePulseSync` и визуальную глубину pulse-модуляции.
- **`BioSignalFrame`** — изменение полей или диапазонов нормализации в адаптере без правки шейдеров mandala даёт рассинхрон.
- **`computePracticeHrvMetricsFullSession` vs старый `computePracticeHrvMetrics`** — итоговые числа в отчёте практики должны оставаться согласованы с тем, что показывает footer до `finalize`, иначе пользователь увидит скачок.
- **`pulseSource: "emulated"`** — downstream обязан не смешивать такие beats с реальными клиническими метриками, если продукт это запретит.
