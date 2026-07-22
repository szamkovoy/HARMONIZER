# Android adaptation notes

Документ-реестр всех мест кода, где мы пока что сделали iOS-only решения и
которые **нужно будет продублировать / адаптировать для Android**, когда
дойдём до сборки под Google Play.

Смысл документа: не потерять ни одной мелочи. Когда пользователь скажет
"переходим на Android", достаточно открыть этот файл, пройти по чек-листу
и реализовать каждый пункт. По мере реализации — ставьте галочки и
подписывайте коммит.

Поиск по кодовой базе: эти места так же помечены тегом-комментарием
`TAG_ANDROID_ADAPTATION`. Grep'ом `TAG_ANDROID_ADAPTATION` вы мгновенно
найдёте все точки, связанные с Android-работой.

## 1. Native модуль BiofeedbackFingerFrameProcessor

**Путь iOS**: `modules/biofeedback-finger-frame-processor/ios/BiofeedbackFingerFrameProcessorModule.swift`

**Android-зеркало (создать)**: `modules/biofeedback-finger-frame-processor/android/.../BiofeedbackFingerFrameProcessorModule.kt`

Функции, которые должны иметь Android-реализацию:

- [x] `setBackTorchLevel(level: Double)` → `CameraManager.turnOnTorchWithStrengthLevel` (API 33+) / `setTorchMode` fallback (`BiofeedbackFingerFrameProcessorModule.kt`, 2026-07-22).
- [x] `turnOffBackTorch()` → `CameraManager.setTorchMode(cameraId, false)`.
- [x] `getThermalState()` → `PowerManager.getCurrentThermalStatus()` + маппинг nominal/fair/serious/critical.
- [x] `subscribeThermalState(callback)` → `PowerManager.addThermalStatusListener` → event `onThermalStateChanged`.
- [x] `getMemoryUsageMb()` → `Debug.MemoryInfo().totalPss / 1024`.
- [x] `getBatteryLevelPct()` → `BatteryManager` / sticky `ACTION_BATTERY_CHANGED`.

**Frame processor:**

- [x] `analyzeFingerRoi` — `AnalyzeFingerRoiFrameProcessorPlugin.kt` (YUV_420_888 ROI + BT.601, тот же JS-контракт). Регистрация в `OnCreate` через `FrameProcessorPluginRegistry`.
- [ ] **Проверить на устройстве после native rebuild** (`npx expo prebuild` / EAS): warmup → QC → practice; OEM-различия torch (Pixel / Samsung / Xiaomi); формат UV (pixelStride); тепло на 15–25 fps.

**Продуктовый guard:** если `isFingerFrameProcessorAvailable()` false (старый APK без плагина), `PracticeCard` / `CoherenceBreathScreen` показывают `sensorCameraUnavailable*` вместо silent simulate.

## 2. Камера и torch — общий гид

**iOS поведение (сейчас)**:
- При `silent=true` сессия **остаётся активной** с захватом **1 fps**, но
  **frame processor полностью снят** с `<Camera>` (проп `frameProcessor=undefined`).
  Причина: чтобы iOS стабильно держал фонарик, нужна живая capture session
  (полная остановка `AVCaptureSession` гасит LED; прямой `setTorchModeOn`
  без удерживающей сессии нестабилен). Но сами YUV-кадры через JSI-мост
  в worklet при этом **не передаются** — VisionCamera не поднимает
  worker-thread frame pipeline. Это заметно снижает тепловой бюджет
  emulated-фазы.
- Torch даёт VisionCamera (`torch="on"`) + периодический `setBackTorchLevel(...)`
  для снижения яркости. Уровни (см. `FingerPpgCameraSource.tsx`):
  - `TORCH_LEVEL_ACTIVATION = 0.55` — в warmup/QC, максимальная надёжность
    активации при охлаждённых пальцах (вазоконстрикция).
  - `TORCH_LEVEL_RUNNING = 0.40` — в основной практике, хороший баланс
    между качеством сигнала и тепловым бюджетом.
  - Попытка понизить базовый уровень до 0.25 провалилась: на прохладной
    коже свет не пробивает палец, PPG получается шумный, пульс «плавает».
  - Позже ненадолго пробовали 0.35/0.45 в попытке ещё снизить нагрев —
    но сигнал оставался слабым, а главная причина нагрева оказалась в
    утечке памяти в VC worker-thread (фикс: frame processor снят в
    silent). После фикса подняли обратно до 0.40/0.55: разница в тепле
    от LED пренебрежима по сравнению с ISP, а качество сигнала
    заметно лучше.

**Android аналог**:
- Тот же паттерн (1 fps + VC torch) — предсказуемо на разных OEM. Дополнительно
  `CameraManager.setTorchMode` часто работает без сессии; если при тестах torch
  стабилен и без активного preview — можно позже оптимизировать (как в старой
  версии iOS-плана), но сначала parity с iOS.

**Потенциальные подводные камни Android**:
- Разные вендоры по-разному трактуют `setTorchMode` при закрытой сессии.
  Нужно протестировать на 3+ устройствах (Pixel, Samsung, Xiaomi).
- API < 23 (Android 5.x) вообще не имеет `CameraManager.setTorchMode` —
  там придётся всё-таки держать Camera2 сессию открытой. Но наш
  `minSdk` скорее всего уже ≥ 24.

## 3. Keep-awake (блокировка сна экрана)

**iOS/Android**: `expo-keep-awake` работает на обеих платформах:
- iOS: `UIApplication.isIdleTimerDisabled`
- Android: `Window.addFlags(FLAG_KEEP_SCREEN_ON)` через activity

Никакой адаптации не требуется, но нужно убедиться при сборке, что пакет
`expo-keep-awake` входит в окончательный APK (по умолчанию да, это peer
`expo`).

## 4. VisionCamera фреймпроцессоры

- [ ] Убедиться, что Kotlin-сторона `BiofeedbackFingerFrameProcessor` собрана
  как VisionCamera frame processor plugin. Инициализация регистрируется
  через `FrameProcessorPluginRegistry.addFrameProcessorPlugin(...)` в
  `CameraPackage` или через Expo modules API.
- [ ] Формат пикселей на Android обычно `yuv_420_888` вместо iOS `yuv`.
  Наш `analyzeFingerRoi` читает `frame.pixelFormat` и должен корректно
  обрабатывать оба варианта. Проверить после портирования.
- [ ] На Android VC часто выдаёт фактический fps, отличный от запрошенного.
  Наш `runAtTargetFps(targetFpsSV.value)` в worklet уже нивелирует это —
  но стоит залогировать `cameraFrameIntervalMsAvg` в перф-диагностике на
  первых Android-запусках.

## 5. `AppState` и фоновые события

На Android есть отличие: при нажатии home переход в `background` происходит
мгновенно, но пока фонарик включён и `foregroundService` не поднят, OS
может убить процесс через 30 с. Если мы хотим чтобы пранаяма продолжалась
при свёрнутом экране — нужно `ForegroundService` с типом `camera` и
notification. **Решение на запуск Android-релиза**: не запускаем в фоне,
корректно приостанавливаем практику в `AppState === "background"`
(уже реализовано через `isActive` в `FingerPpgCameraSource`).

## 6. Файл экспорта JSON (share sheet)

- iOS использует `Share.share({ url })` + `getContentUriAsync` — на
  Android `getContentUriAsync` возвращает `content://` URI, а не
  `file://`, нужно проверить, что Share принимает.
- Альтернатива: `expo-sharing` (portable). Посмотреть при релизе.

### Авто-телеметрия (`DEBUG_ACTIVATION_EXPORT_ENABLED`)

В бета-периоде ручная кнопка «Отправить отчёт разработчику» в диалоге
«Пульс не распознан» вызывает Share sheet с файлом
`breath-activation-diagnostic-<ts>.json` (схема
`activation-diagnostic-v3`). Схема включает:

- `sessionContext` — `activationSessionId` + `attemptNumber` (группировка
  попыток в рамках одной «сессии выбора практики» пользователем),
  `breathPracticeId`, параметры формы (`phases.length`, `baseIndex`).
- `deviceInfo` — `platform`, `osVersion`, `deviceName`, `appVersion`.
- `systemDiagnostics` — `thermalState`, `memoryMb`, `batteryPct`
  (native iOS: thermal из `ProcessInfo`, memory из
  `mach_task_basic_info`, battery из `UIDevice`).
- `qcLastEvaluation` — полный срез пороговых проверок, какие прошли/не
  прошли (`conditions: {signalQualityOk, beatsInWinOk, bpmStdevOk,
  bpmAgreementOk, …}`) плюс `bpmAgreement` (согласие между двумя
  оценщиками BPM в pipeline: `snap.pulseRateBpm` и
  `peakDetector.lastMedianRrInPeakWindowMs`). `bpmAgreementOk` — защита
  от ложно-низких значений: если оценщики расходятся > 8 BPM, активация
  отклоняется (случай 22 апр: был пропущен пульс 53 BPM, который на
  самом деле был артефактом 2:1-пропуска пиков в последних 10 с QC).

**Android-задача**: при портировании `getThermalState` /
`getMemoryUsageMb` / `getBatteryLevelPct` (см. раздел 1) эта телеметрия
заработает сразу — схема JSON platform-agnostic. Единственное: для
`deviceInfo.deviceName` Android использует другое поле в expo-constants
(`Device.deviceName` из `expo-device`, если добавим, либо
`Build.MODEL`). Сейчас используется `Constants.deviceName` — на Android
оно тоже резолвится (user-set device alias), так что работать должно.

**Перспектива (после релиза)**: текущая схема — фундамент для
облачной базы данных. Пользовательские клиенты будут POST'ить этот JSON
на серверный endpoint (вместо Share sheet), чтобы агрегировать статистику
по отказам активации / телеметрию практик. Сейчас Share sheet — локальная
замена этого механизма. Этот переход не потребует изменения схемы.

## 7. Haptic feedback (если добавим)

На iPhone используем `Haptics.selectionAsync()` из expo-haptics;
на Android нужно убедиться, что `VIBRATE` разрешение в манифесте и
устройство поддерживает (`Vibrator.hasVibrator()`).

## 8. Общее замечание по тепловому режиму

На Android нет эквивалента `ProcessInfo.thermalState` до API 29.
Для младших версий можно использовать:
- Температуру батареи (`BatteryManager.BATTERY_PROPERTY_TEMPERATURE`).
- CPU frequency throttling (непрямой индикатор — если частоты падают,
  значит throttling активен).
- Наш `JankDetector` (UI fps, frame processor latency, JS loop lag) —
  **эти сигналы не зависят от платформы** и должны одинаково работать
  на iOS и Android.

**Важно**: JankDetector уже готов к Android без изменений. Это наш
основной fallback для триггера гибридного режима.

## 9. Гибридный режим измерения (флаг `ENABLE_HYBRID_EMULATION`)

В `CoherenceBreathScreen.tsx` стоит константа
`ENABLE_HYBRID_EMULATION = false`. Это означает, что **PPG/камера
работают всю практику непрерывно**, а `HybridMeasurementController`
используется исключительно для разметки границ dual-window merge
(`rs` и `re`): отчёт строится по началу + концу, но данные pipeline
accumulated непрерывно, и индикатор дыхания всегда синхронизирован с
реальным пульсом через `BreathPhasePlanner.planNextCycle()`
(полуволновая RSA-модуляция длительности фаз).

Исторический контекст (почему переключили):
- Тест 1776891125997 показал, что `jsTimerLag ≈ 1000 мс` наблюдается
  с первых секунд практики, а UI fps p5 = 11-15 в `realEnd` —
  независимо от того, была ли `emulated`-фаза посередине.
- Также RSA-индикатор на эмуляции замирал (baseline заморожен, beats
  не приходят), что убивало ощущение «дыхание за пульсом».

**Для Android**: флаг тот же. Если на слабых Android-устройствах
появится thermal-критический throttling (`PowerManager` покажет
`THERMAL_STATUS_SEVERE`) — можно временно включить флаг в true. Но
сначала проверить, действительно ли непрерывный PPG вредит, или
проблема в другом (память, GC, фоновые потоки).

**Утечка памяти — отдельная задача**. В экспорте 1776891125997
`nativeMemoryMb` рос с 270 до 650 МБ за 3 минуты. Это не лечится
отключением frame processor'а (тест показал, что в `emulated` фазе
память всё равно растёт до 500-585 МБ). Корневая причина пока не
найдена; подозрения: (a) `opticalRingBuffer` накапливается быстрее,
чем чистится; (b) `coherenceEngine.getPerSecondWindow()` кэш растёт;
(c) Reanimated shared values / worklet closures. Требуется отдельный
heap-snapshot анализ.

## 10. Live/batch разделение pipeline (`setMetricsCapturePaused`)

Апр 2026: на основе предложения «разделить алгоритм на лёгкий (для
синхронизации) и тяжёлый (для метрик)» в `BiofeedbackPipeline`
добавлен гейт `setMetricsCapturePaused(boolean)`. При включении он:

- **пропускает** `HrvBeatAccumulator.ingest(...)` — beats перестают
  накапливаться в HRV-накопителе,
- **пропускает** периодический HRV/stress compute (троттлинг 10 с).

НЕ пропускаются:
- `peakDetector` / `pulseBpmEngine` → пульс/BPM-публикации живут;
- `coherence.appendBeats(...)` и `tickLive(...)` → RSA-индикатор
  в реальном времени модулирует длительность дыхательных фаз.

Гейт активируется в `CoherenceBreathScreen.tsx` при входе в фазу
`emulated` гибридного режима. Смысл: метрики отчёта всё равно
строятся только по двум окнам (`realStart` + `realEnd`), поэтому
накопление в середине — мёртвый вес (увеличивает CPU/память без
влияния на результат).

**Для Android**: код platform-agnostic, нужно убедиться, что
`setMetricsCapturePaused` вызывается и снимается симметрично
(при `realEnd` → `setMetricsCapturePaused(false)`). Также при
`softReset()` и `reset()` гейт автоматически сбрасывается.

## 11. Baseline BPM в результатах

Апр 2026: экран результатов теперь показывает строку
`{baselineBpmTrendLabel}: 72 → 80 уд/мин (мин 68, макс 82)`.
Источник — `exportDebug.baselineBpmSummary` (новое поле в
`CoherenceExportDebug`), считается в `CoherenceBreathScreen.tsx`
из `baselineBpmSeriesRef` (медианы головы/хвоста серии, мин/макс,
среднее).

Baseline BPM — это скользящая EMA, которую использует
`BreathPhasePlanner` для планирования циклов. Это устойчивая
оценка реакции вегетатики на практику (эмпирически: с задержками
пульс плавно растёт на 5-10 уд/мин, чистое когерентное —
остаётся на уровне или чуть падает).

**Для Android**: отдельной работы не требуется (UI код кросс-
платформенный).

---

## 12.1 Асимметричный fps камеры: warmup vs running

Апр 2026: `FingerPpgCameraSource` использует **два** целевых fps:

- `HIGH_PRECISION_PPG_FPS = 30` — только во время warmup/QC
  (≤ 20 с). Даёт максимально плотный PPG-график для активации.
- `TARGET_PPG_FPS = 15` — весь длинный замер (realStart + emulated +
  realEnd). Исторически проверенный экономный уровень (эксперимент
  с 25 Hz вызвал термальное троттлирование за 3 мин вместо 8).

Переключение — через prop `captureRateHint` от
`CoherenceBreathScreen.tsx`:

```ts
captureRateHint={phase === "warmup" || phase === "qualityCheck" ? "highPrecision" : "normal"}
```

Android зеркально должен поддерживать такую смену — в Camera2 это
пересоздание `CaptureRequest` с новым `FPS_RANGE`, VisionCamera
делает это автоматически через `useCameraFormat` hook.

---

## 12.1.5 Разделение `shellStaticData` / `shellDrawData` в мандале

Апр 2026: ранее `shellDrawData` useMemo пересчитывался на каждый тик
`timeSeconds` и внутри создавал `Skia.Path.Make()` × N shell'ов +
вычислял все opacity-формулы. Это давало ~180 000 нативных Skia
path-аллокаций за 20 минут → накопительная фрагментация нативной
памяти, GC-паузы в последние 2-3 минуты практики.

Сделан split на два уровня:
 - `shellStaticData` (useMemo по `shellStack`, `boundaryDrawData`,
   `size`, `densityBias`, `stackOuterLimit`) — пути, opacities,
   статические uniforms. Создаётся один раз на монтирование.
 - `shellDrawData` (useMemo по `timeSeconds`, `contentTime`,
   `shellStaticData`) — на тик только собирает JS-объект с shader
   uniforms (`contentTime` + `ringRotation`). Нет native allocations.

Per-tick cost упал в ~50×. Это кросс-платформенное улучшение
(Skia/Canvas одинаково на iOS/Android).

---

## 12.2 Частота тиков мандалы (`targetFps` в `BinduSuccessionLabCanvas`)

Апр 2026: `useAnimationClock` мандалы понижен с 30 Hz до 15 Hz по
умолчанию (`DEFAULT_MANDALA_TARGET_FPS`). Причина — на iOS под
thermal throttling 30 setState/с + тяжёлый `shellDrawData` useMemo
(создаёт `Skia.Path.Make()` × число shell'ов) не успевают и
вызывают накопительное торможение в последние 3-5 минут длинных
практик.

Значение задаётся параметром `targetFps?: number` в
`BinduSuccessionLabCanvas` и `BreathBinduMandala`, меняется на
лету (хранится в ref, без пересоздания RAF-loop).

**Для Android**: значение 15 Hz кросс-платформенно оптимально.
Дополнительно можно проверить на слабых Android-устройствах —
если shader-uniform'ы Skia всё ещё упираются в GPU, можно опустить
до 10 Hz через `targetFps={10}` из `BreathBinduMandala` в
`CoherenceBreathScreen`. Ничего менять в native-слое не нужно.

---

## Чек-лист релиза Android

Перед подготовкой Android-сборки пройти по всем пунктам выше, убедиться
что:

- [ ] Все native-функции имеют Kotlin-реализацию
- [ ] Frame processor plugin зарегистрирован
- [ ] Torch heartbeat проверен на 3+ устройствах
- [ ] `expo-keep-awake` включён в сборку
- [ ] AndroidManifest.xml содержит `CAMERA` permission
- [ ] `minSdk >= 24` (для `CameraManager.setTorchMode`)
- [ ] Тепловой триггер из `PowerManager.getCurrentThermalStatus` работает
- [ ] Логирование перф-диагностики проверено — сравнить avg frameProc
      latency и jsTimerLag с iOS-данными

---

### Мета

- Обновляйте этот документ каждый раз, когда добавляете новый iOS-only
  код с тегом `TAG_ANDROID_ADAPTATION`.
- Ссылки на конкретные файлы должны указывать на абсолютные пути в репо;
  не используйте относительные пути вида `../../../..`.
