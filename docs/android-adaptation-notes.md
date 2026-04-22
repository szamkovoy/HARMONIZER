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

- [ ] `setBackTorchLevel(level: Double)` → на Android используется
  `CameraManager.setTorchMode(cameraId, enabled=true)` с brightness
  через `CameraManager.turnOnTorchWithStrengthLevel(cameraId, strengthLevel)`
  (API 33+). До API 33 — только on/off без уровня. В этом случае
  игнорируем `level` и просто включаем фонарик.
- [ ] `turnOffBackTorch()` → `CameraManager.setTorchMode(cameraId, false)`.
- [ ] `getThermalState()` → Android использует `PowerManager.getCurrentThermalStatus()`
  (API 29+). Маппинг:
  - `THERMAL_STATUS_NONE/LIGHT` → `"nominal"`
  - `THERMAL_STATUS_MODERATE` → `"fair"`
  - `THERMAL_STATUS_SEVERE` → `"serious"`
  - `THERMAL_STATUS_CRITICAL/EMERGENCY/SHUTDOWN` → `"critical"`
- [ ] `subscribeThermalState(callback)` → `PowerManager.addThermalStatusListener(listener)`.
- [ ] `getMemoryUsageMb()` → `Debug.MemoryInfo().getTotalPss() / 1024` или
  `ActivityManager.getProcessMemoryInfo(myPid())`.
- [ ] `getBatteryLevelPct()` → `BatteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)`.

**Дополнительно**: frame processor plugin для VisionCamera должен быть
реализован на Android (Kotlin + JNI) чтобы `analyzeFingerRoi` работал.
У VisionCamera есть отдельный API для Android frame processor plugins.
См. https://react-native-vision-camera.com/docs/guides/frame-processors-plugins-overview

## 2. Камера и torch — общий гид

**iOS поведение (сейчас)**:
- При `silent=true` сессия **остаётся активной** с захватом **1 fps**, worklet
  не вызывает `analyzeFingerRoi` (эмуляция пульса в pipeline). Причина:
  полная остановка `AVCaptureSession` (`isActive=false`) на iOS гасит LED; вызов
  `setTorchModeOn` из нативного модуля без удерживающей сессии нестабилен.
  Torch даёт VisionCamera (`torch="on"`) + периодический `setBackTorchLevel(0.35)`
  для снижения яркости.

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
