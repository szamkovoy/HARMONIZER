# BIOFEEDBACK

Модуль биологической обратной связи для HARMONIZER. Его задача — получать живой сигнал от пользователя, извлекать из него устойчивые метрики и передавать нормализованный поток в `Mandala_Visual`.

## Назначение

Первая версия модуля должна закрыть три задачи:

- читать пульс из двух источников камеры:
  - палец на основной камере со вспышкой (`finger PPG`);
  - лицо на фронтальной камере (`face rPPG`);
- извлекать дыхательный ритм, если сигнал это позволяет;
- отдавать данные в совместимом виде для `MANDALA`.

## Принцип разработки

Модуль строится слоями:

1. захват сигнала;
2. фильтрация и извлечение пиков;
3. вычисление метрик;
4. нормализация для `Mandala_Visual`;
5. fail-safe fallback, если сигнал потерян.

Это позволяет отдельно разрабатывать математику, источник сигнала и интеграцию с мандалой.

## Что считаем важным в V1

- главная метрика вариабельности: именно `RMSSD`, не общий термин `HRV`;
- стресс считаем через индекс Баевского и затем переводим в продуктовый диапазон `0..100`;
- `fingerCamera` и `faceCamera` рассматриваются как два равноправных источника;
- при плохом сигнале система не замирает, а плавно переходит на симуляцию.

## Базовый pipeline

### 1. Finger PPG

- пользователь закрывает камеру пальцем;
- включается вспышка;
- из ROI строится временной ряд по среднему значению цветового канала;
- применяется фильтрация в диапазоне человеческого пульса;
- детектируются пики;
- считаются `RR intervals`, `RMSSD`, `stressIndex`.

### 2. Face rPPG

- фронтальная камера смотрит на лицо;
- выбирается стабильная зона лица;
- строится оптический временной ряд;
- отдельно выделяются пульсовая и дыхательная полосы;
- при хорошем свете и низком движении сигнал может использоваться непрерывно во время практики.

## Интеграция с Mandala_Visual

`MANDALA` уже ожидает нормализованный `BioSignalFrame`.

Для этого в модуле есть адаптер:

- `core/mandala-adapter.ts`

Он переводит физические значения:

- `pulseRateBpm`
- `breathRateBpm`
- `rmssdMs`
- `stressIndex`

в нормализованный формат для визуального runtime.

## Текущие файлы

- `core/types.ts` — типы источников, кадров и конфигураций;
- `core/metrics.ts` — вычисление `RMSSD`, индекса Баевского и нормализация;
- `core/finger-analysis.ts` — первый live analyzer для `fingerCamera`: ROI optical series, quality gate, peak/RR draft.
- `core/mandala-adapter.ts` — адаптер в `BioSignalFrame`.
- `core/simulated.ts` — simulated bio-frames для UX и интеграционного preview;
- `ui/BiofeedbackProbeScreen.tsx` — dual-mode probe-экран:
  - Expo Go fallback;
  - native `VisionCamera` path в dev build с quality-gated `fingerCamera` analyzer.
- `../biofeedback-finger-frame-processor` — local Expo module + VisionCamera frame processor plugin для center ROI на iOS.

## Технический курс

На текущем этапе модуль intentionally не завязан на конкретный camera SDK.

Причина:

- математика сигнала и runtime-контракт нужны независимо от того, будет ли захват идти через `expo-camera`, `VisionCamera`, локальный Expo module или другой нативный слой.

Практический вывод:

- сначала фиксируем контракт и математику;
- затем подключаем реальный слой камеры;
- после этого интегрируем поток в `Mandala_Visual` и в будущий `BREATH`.

## Важное ограничение Expo-probe

Текущий probe-экран на `expo-camera` полезен для:

- проверки permission flow;
- проверки preview UX;
- проверки torch в finger-режиме;
- проверки удобства `finger` vs `face`.

Но он не дает raw frame / pixel access, поэтому:

- не извлекает настоящий PPG waveform;
- не позволяет честно сравнить качество сигнала `Expo vs Native` по графику;
- не является финальной sensor-реализацией.

Именно поэтому `expo-camera`-probe — это этап проверки UX и общей feasibility, а для настоящего сигнального A/B позже может понадобиться отдельный native frame layer.

## Текущее native-состояние

В проект уже добавлены:

- `react-native-vision-camera`
- `react-native-worklets-core`

Их роль:

- `VisionCamera` дает native preview и доступ к frame processor pipeline;
- `react-native-worklets-core` позволяет запускать frame processing внутри native camera runtime.

Важно:

- в Expo Go модуль остается в fallback-режиме;
- в dev build тот же `Biofeedback Probe` автоматически становится native-экраном;
- `fingerCamera` теперь уже читает center ROI и строит реальный optical series;
- live path теперь дополнительно проверяет сам факт finger contact, чтобы без пальца `Quality Gate` и `Cadence Lock` не продолжали притворяться валидным измерением;
- live contract поднимается только после quality gate, иначе экран мягко остается на simulated fallback;
- если устойчивый cadence уже найден, analyzer короткое время удерживает последнюю стабильную частоту, а после relock плавно перестраивается на новый BPM вместо резкого сброса;
- `BPM`, `RMSSD` и индекс стресса теперь больше не делят одно и то же короткое окно:
  - `BPM` идет через rolling window `10s`;
  - `RMSSD` начинает считаться только после `30s`;
  - индекс стресса получает `60s` fast-tier и `90s` stable-tier;
- `RR` перед расчетом метрик проходит каскадный firewall: физиологические границы, процентный фильтр и MAD/Hampel-style коррекцию;
- probe-экран теперь показывает warming/ready состояния метрик, чтобы не выдавать сырые ранние значения за полноценное измерение;
- warming-таймеры (`Pulse`, `RMSSD`, `Stress`) работают как монотонный wall-clock счетчик:
  - пока палец на камере, прогрев идет только вперед;
  - кратковременная потеря сигнала или качества не сбрасывает прогрев;
  - warming замораживается при потере контакта и продолжается с того же места при возврате;
  - полный сброс происходит только после `10s` непрерывного отсутствия пальца;
- `Pulse`, `RMSSD` и `Stress` теперь идут фазами, ближе к реальному product UX:
  - сначала отдельно захватывается и валидируется пульс;
  - `RMSSD` и `Stress` начинают свои окна только после того, как валидный пульс уже удерживается;
  - если после `10s` прогрева пульс не подтверждается, pulse-cycle перезапускается, а UI не делает вид, что `RMSSD` и `Stress` уже готовы;
- определение пульса теперь intentionally упрощено:
  - peak detector больше не навязывает ритм через ACF-guided anchor windows;
  - beats ищутся как локальные максимумы на сглаженном detrended signal с adaptive height/prominence threshold и timestamp-based refractory period;
  - history последних beat timestamps больше не только дописывается: recent tail пересобирается заново на каждом шаге, чтобы не консервировать старые ошибки детектора;
  - **BPM**, **RMSSD** и **Stress Index** считаются только из реально принятых RR-интервалов; подозрительные интервалы отбрасываются, но не заменяются медианой;
  - probe-экран показывает candidate/accepted/rejected peaks, raw RR list, median RR и reason codes для rejected peaks, чтобы на устройстве было видно источник ошибки;
  - пульс не отображается до завершения прогрева и накопления когерентного RR-окна; если ритм не выглядит правдоподобным, UI должен оставаться в validating/holding, а не придумывать новый BPM;
- `faceCamera` пока остается scaffold-only и не выдает живой сигнал.

## Dev build на iPhone

Базовый native probe уже поднят и проходит on-device validation через dev client:

1. маршрут `biofeedback-probe` в dev build открывается как `Native Probe`;
2. `fingerCamera` использует back camera, `VisionCamera`, local frame processor и live center ROI analyzer;
3. `Processed Frames`, `Frame Size`, `Pixel Format` и `Optical Series` должны жить на реальном устройстве;
4. `Quality Gate` может переключаться между fallback и live;
5. краткая потеря сигнала теперь не обязана мгновенно сбрасывать cadence, если lock уже был найден;
6. `faceCamera` все еще intentionally отложен до завершения `fingerCamera` validation.

В проекте для этого уже добавлены:

- `expo-dev-client`;
- `eas.json` с профилем `development`;
- npm scripts для локального и cloud dev-build flow.
- `npm run doctor:ios:biofeedback` — локальная проверка готовности Xcode / Homebrew / CocoaPods / EAS CLI.

Полезные команды:

- `npm run start:dev-client` — запуск Metro для dev client;
- `npm run ios:device` — локальная сборка и установка на подключенный iPhone через Xcode toolchain;
- `npm run build:ios:dev` — cloud dev build через EAS для установки на реальное устройство.
- `npm run doctor:ios:biofeedback` — quick doctor для локального iOS toolchain.

Минимальный on-device чек после установки:

- открыть `Biofeedback Probe`;
- убедиться, что заголовок стал `Native Probe`, а не `Expo Probe`;
- в `fingerCamera` проверить back camera и torch;
- убедиться, что `Frame Size`, `Pixel Format` и `Processed Frames` перестали быть пустыми;
- убедиться, что появился блок `Finger ROI Analyzer` и в нем растет `Optical Series`;
- проверить, что при хорошем контакте пальца `Quality Gate` может перейти из `Fallback Active` в `Passed`;
- проверить, что после снятия пальца `Finger Contact` уходит в `Missing`, а `Quality Gate` и `Cadence Lock` быстро перестают показывать валидное измерение;
- проверить, что `Cadence Lock` может дойти до `Tracking`, а при кратком микродвижении перейти в `Holding`, не теряя пульс мгновенно;
- проверить, что warming-таймеры (`Pulse`, `RMSSD`, `Stress`) монотонно растут при контакте пальца и не прыгают обратно к `0` при кратких просадках сигнала;
- проверить, что `Pulse Estimate` сначала прогревается до `10s`, `RMSSD` не появляется раньше `30s`, а `Stress Window` не притворяется готовым раньше `60s`;
- проверить, что `RMSSD` при неподвижном пальце больше не гуляет хаотично, а `HRV Confidence` не падает без явного ухудшения сигнала;
- проверить, что индекс стресса на `60s` появляется как fast estimate, а после `90s` стабилизируется сильнее;
- помнить, что `breath` и `faceCamera` пока intentionally не считаются живыми.
