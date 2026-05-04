/**
 * FingerPpgCameraSource: монтирует VisionCamera + frame plugin и подаёт сэмплы в Pipeline.
 *
 * Заменяет `BreathFingerCapture` и часть `BiofeedbackProbeScreen`. Не отдаёт snapshot
 * наружу через props — данные идут в Bus, экраны подписываются через `useBiofeedbackChannel`.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";

import {
  analyzeFingerRoi,
  isFingerFrameProcessorAvailable,
  setBackTorchLevel,
  turnOffBackTorch,
  type FingerFrameProcessorResult,
} from "@/modules/biofeedback-finger-frame-processor/src";
import { useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import type { BiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-pipeline";

/**
 * Колбэк диагностики кадров (опциональный). Вызывается из JS потока на каждом
 * принятом frame processor'ом сэмпле. `processingMs` — время работы
 * `analyzeFingerRoi` в нативном плагине (измеряется в worklet `Date.now()`),
 * `receivedAtMs` — момент доставки сэмпла в JS. Используется jank-детектором
 * в `CoherenceBreathScreen` для независимой оценки нагрузки.
 */
export type FingerPpgFrameStats = {
  processingMs: number;
  receivedAtMs: number;
};

type Props = {
  isActive: boolean;
  /** Стиль контейнера камеры. По умолчанию — невидимая 2x2 точка. */
  style?: ViewStyle;
  /** Если true — контейнер камеры отрисовывается обычным размером (для probe-экрана). */
  visible?: boolean;
  /**
   * Гибридная фаза «эмуляция пульса»: **не** собираем PPG (worklet выходит
   * до `analyzeFingerRoi`), но **сессия камеры остаётся активной** с захватом
   * **1 fps**.
   *
   * Почему нельзя было делать `isActive=false` у VisionCamera и держать
   * torch через `setBackTorchLevel` из нативного модуля: на iOS после
   * `AVCaptureSession.stopRunning()` система сбрасывает `torchMode`, а прямой
   * вызов `setTorchModeOn(level:)` **без удерживающей capture-сессии** на
   * части устройств/прошивок не удерживает LED стабильно — пользователь
   * видел гашение фонарика вместе с камерой. Надёжный контракт: либо активная
   * сессия + `torch` у VisionCamera, либо отдельная минимальная сессия в
   * нативном коде (не внедряли). Здесь — сессия на 1 fps: ISP нагружает в
   * ~15 раз меньше, чем при 15 fps, зато LED остаётся включённым штатно.
   */
  silent?: boolean;
  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS
   *
   * Колбэк для jank-детектора. Вызывается из JS на каждый принятый frame
   * processor'ом сэмпл. Родитель (CoherenceBreathScreen) передаёт сюда
   * `jankDetectorRef.current.pushFrameProcLatency`. Удалить вместе с
   * диагностикой перегрева.
   */
  onFrameStats?: (stats: FingerPpgFrameStats) => void;
  /**
   * Режим сэмплинга:
   *  - "normal" (по умолчанию): fps = [1, TARGET_PPG_FPS(15)]. Используется
   *    во время основной практики — компромисс между точностью PPG и теплом.
   *  - "highPrecision": fps = [1, HIGH_PRECISION_PPG_FPS(25)]. Используется
   *    в фазах warmup/qualityCheck, когда практика ещё не началась и тепло
   *    не успевает накопиться. Даёт более плотный raw PPG график на экране
   *    активации пульсометра: пользователь видит живую кривую, а не редкие
   *    точки раз в ~60 мс, и доверяет «угадыванию пульса» приложением.
   *    Суммарное время в этом режиме — 20 с (warmup 10 с + QC 10 с), что
   *    пренебрежимо мало для теплового бюджета.
   */
  captureRateHint?: "normal" | "highPrecision";
};

/**
 * Целевая частота PPG во время **длинной** практики (running).
 *
 * Эволюция:
 *  - 30 Hz (старт проекта) — быстрый нагрев, уже на 2 мин термальное
 *    троттлирование.
 *  - 10 Hz (baseline коммита `433bade`) — исторически стабильные 8 мин
 *    первого реального замера на холодном iPhone.
 *  - 15 Hz (компромисс) — чуть плотнее RR (квантование 67 мс против
 *    100 мс), сигнал визуально живее, тепловой бюджет почти тот же,
 *    что у 10 Hz.
 *  - 25 Hz (неверный эксперимент) — во время работы над активацией
 *    подняли до 25 Hz «для более живого графика». Результат: +67 %
 *    работы ISP/DMA/YUV-JSI мост весь длинный замер → термальное
 *    троттлирование за 3 минуты вместо 8 (практика 1776891125997).
 *  - **15 Hz (текущее)** — возврат к разумной экономии. Решение:
 *    высокую точность даём только на 20 с активации через
 *    `HIGH_PRECISION_PPG_FPS`, а длинный замер идёт на экономном 15 Hz.
 *
 * Обоснование 15 Hz:
 *  - пульс 40..180 BPM = 0.67..3 Hz → Найквист даёт ~5× запас;
 *  - квантование RR = 67 мс — приемлемо для RMSSD (средний RMSSD
 *    взрослого 20..60 мс, но реальный RMSSD считается на разности
 *    ΔRR подряд, и шум квантования в ΔRR ≈ 2 × 67 мс / √N сильно
 *    гасится за 30+ ударов);
 *  - refractory peak-detector'а 300 мс = 4-5 кадров — достаточно для
 *    уверенного отсечения double-peak артефактов;
 *  - тепловой бюджет: 15 Hz × 20 мин × 640×480 YUV buffer = ISP
 *    работает на ~40 % меньше чем при 25 Hz, LED `setTorchModeOn`
 *    тот же. Эмпирически — достаточно, чтобы первое реальное окно
 *    стабильно шло 6-8 минут.
 */
const TARGET_PPG_FPS = 15;

/**
 * Повышенная частота PPG для фаз warmup/qualityCheck (суммарно ≤ 20 с).
 *
 * На этой короткой фазе тепловой бюджет ничтожен (600 кадров за всё
 * время), а точность детекции первых beat'ов для активации критична:
 * пользователь видит оптический график и оценивает «работает ли
 * вообще». При 30 Hz кривая PPG читается как чёткая синусоида, RR
 * квантуется с точностью 33 мс.
 *
 * После QC `CoherenceBreathScreen` меняет `captureRateHint` с
 * `highPrecision` на `normal` → камера переключается на экономный
 * `TARGET_PPG_FPS`. Переход бесшовный для пользователя.
 */
const HIGH_PRECISION_PPG_FPS = 30;

/**
 * Шаг субсэмплинга пикселей в ROI в native frame processor'е.
 * Эволюция: 4 → 6 → 8 → 6 → 4 → **6** (безопасный компромисс).
 *
 * При формате 640×480 и roiScale 0.34 размер ROI ≈ 218×163 = 35k
 * пикселей. Stride 6 → плагин читает ≈ 970 пикселей/кадр, stride 4 →
 * ≈ 2200 пикселей/кадр. Это Accelerate/vDSP SIMD-mean, сам по себе
 * шаг по CPU почти бесплатный, но каждый прочитанный пиксель — это
 * промах в кэше L1/L2 на YUV-буфере, который ISP только что записал.
 * При высоких fps (15+) эти промахи суммируются в заметное давление
 * на контроллер памяти SoC (отдельный источник тепла).
 *
 * Stride 6 исторически (commit 433bade, stable 8 мин первого окна)
 * не давал заметного шума даже на неоднородной коже. Переход на
 * stride 4 в попытке «ещё усилить сигнал» не оправдался: шум PPG
 * определяется световым шумом LED, а не плотностью сэмплирования.
 */
const PPG_SAMPLE_STRIDE = 6;

/**
 * Уровни яркости задней вспышки для PPG-замеров.
 *
 * История калибровки:
 *  - 1.0 (по умолчанию VisionCamera при torch="on") — избыточно яркий, греет
 *    LED сильнее, чем нужно для качественного сигнала;
 *  - 0.35 — базовый рабочий уровень ~2 мес, сигнал стабильный на тёплых
 *    и умеренно-прохладных пальцах;
 *  - 0.25 (короткий эксперимент в попытке ещё снизить нагрев) — провал:
 *    при прохладной коже с суженными капиллярами (вазоконстрикция) свет
 *    не пробивает палец недостаточно для уверенной пульсации. Симптом —
 *    хаотичный рваный график PPG вместо чёткой синусоидальной волны, и
 *    «скачущий» пульс (49→89→70→40) в практике;
 *  - 0.35/0.45 (running/activation) — компромисс, попытка снизить нагрев.
 *    По факту оказался недостаточным: пользователь продолжал видеть
 *    слабый/рваный сигнал, а главная причина нагрева (утечка памяти в
 *    VisionCamera worker-thread) лежала вне тепловой петли LED.
 *  - 0.40/0.55 — короткий эксперимент «подкачать свет для чистоты
 *    сигнала». Ошибка: на активации torch 0.55 **пересвечивал ROI**.
 *    Симптомы: в `calculateSignalQuality` падал `exposureScore`
 *    (штраф за luma > 0.55), рос `saturationPenalty`, красный канал
 *    приближался к клипингу → получался «симметричный шум» вместо
 *    чёткой пульсовой волны, один удар на графике превращался в
 *    пару «светлый + тёмный» столбик одинаковой высоты, peak-детектор
 *    насчитывал удвоенный BPM.
 *  - **0.35/0.35 — возврат к исторически проверенному baseline**
 *    (`433bade`). На этом уровне пульс ловился стабильно за 5 с,
 *    экспозиция оптимальна (luma ≈ 0.55), saturation в норме. Если
 *    на холодных пальцах активация окажется «туже» — её поднимем
 *    по результатам диагностики, а не вслепую.
 *
 * TAG_ANDROID_ADAPTATION: на Android `setBackTorchLevel` вернёт `false`
 * (Camera2 у большинства OEM не даёт управлять яркостью LED), и тогда
 * `torch="on"` у VisionCamera включает LED на 100 %. Это надо учесть при
 * адаптации: либо писать собственный Camera2 путь (flashlight manager),
 * либо принять полную яркость и признать, что тепловой профиль Android
 * будет хуже — и компенсировать за счёт более раннего перехода в
 * emulated-режим через jank-детектор.
 */
const TORCH_LEVEL_RUNNING = 0.35;
const TORCH_LEVEL_ACTIVATION = 0.35;

/** Дать VisionCamera время поднять сессию до `torch="on"` (см. configureTorch в VC). */
const TORCH_ARM_DELAY_MS = 450;
/** После VC-torch не сразу дёргаем нативный `setTorchModeOn(level:)` — избегаем гонки с lock сессии. */
const TORCH_NATIVE_LEVEL_DELAY_MS = 750;
/**
 * Не вызываем `turnOffBackTorch` мгновенно при кратком `isRenderActive=false`:
 * иначе нативный lock на том же AVCaptureDevice, что у VisionCamera, ломает включение лампы.
 */
const TURN_OFF_TORCH_DEBOUNCE_MS = 450;

/**
 * FingerPpgCameraSource намеренно обёрнут в `React.memo`: его родители
 * (`CoherenceBreathScreen`) ре-рендериваются несколько раз в секунду (snapshot
 * bump 4 Гц, подписки на `pulseBpm` и т.д.). При каждом re-render'е родителя
 * без memo этот компонент тоже вызывал свой рендер, внутри которого создавался
 * НОВЫЙ `reportFrame = Worklets.createRunOnJS(handleFrame)`, а следом — НОВЫЙ
 * frame processor (т.к. deps useFrameProcessor = [reportFrame]).
 *
 * Это — главная причина, почему на реальной PPG-камере через 10 минут практики
 * приложение начинало тормозить и иногда падало по памяти: каждые ~250 мс мы
 * создавали новую worklet-обёртку в JSI + новый VisionCamera frame processor,
 * старые не всегда успевали освободиться. За 20 минут — 4800 ре-созданий
 * worklet-wrappers в native-слое, откуда и "накопительное" торможение и OOM.
 *
 * С memo компонент рендерится только при смене собственных props
 * (`isActive`/`visible`/`style`). Дальше `reportFrame` стабильно кэшируется
 * в `useMemo`, и frame processor создаётся ровно один раз за монтирование.
 *
 * Дополнительно мы сняли `pipeline` из deps `handleFrame`: провайдер держит
 * pipeline стабильной ссылкой, но любые false-срабатывания (перемонтирование
 * провайдера при HMR) больше не форсят пересоздание worklet-моста.
 */
function FingerPpgCameraSourceImpl({
  isActive,
  style,
  visible = false,
  silent = false,
  onFrameStats,
  captureRateHint = "normal",
}: Props) {
  const VisionCamera = require("react-native-vision-camera") as typeof import("react-native-vision-camera");
  const WorkletsCore = require("react-native-worklets-core") as typeof import("react-native-worklets-core");
  const {
    Camera,
    useCameraPermission,
    useCameraDevice,
    useCameraFormat,
    useFrameProcessor,
    runAtTargetFps,
  } = VisionCamera;
  const { Worklets } = WorkletsCore;

  const pipeline = useBiofeedbackPipeline();
  // Через ref: handleFrame на JS-стороне всегда видит актуальный pipeline, но
  // ссылочно стабилен — значит и reportFrame/frameProcessor не пересоздаются.
  const pipelineRef = useRef<BiofeedbackPipeline>(pipeline);
  pipelineRef.current = pipeline;

  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchArmed, setTorchArmed] = useState(false);
  const { hasPermission, requestPermission } = useCameraPermission();
  const permissionRequestedRef = useRef(false);
  const [showOpenSettingsHint, setShowOpenSettingsHint] = useState(false);

  /**
   * `isRenderActive` — общий признак, что компонент «хочет» работать (экран в
   * фокусе, приложение на переднем плане, родитель не размонтирует).
   * `isCameraSessionActive` — VisionCamera `<Camera isActive>`. При
   * `silent=true` сессия **остаётся включённой** (см. JSDoc к `silent`), иначе
   * iOS гасит фонарик вместе с остановкой сессии.
   *
   * Важно: при жесте «обзор приложений» / частичном свайпе iOS даёт `AppState`
   * `inactive`, а React Navigation может временно дать `useIsFocused() === false`.
   * Раньше требовали строго `active` + `focused` — фонарик гас мгновенно, хотя
   * пользователь ещё не ушёл в другое приложение. Держим сессию в `inactive`,
   * пока родитель передаёт `isActive`, и разрешаем `inactive` без focus.
   * В `background` сессию держим, пока родитель передаёт `isActive` (политика
   * дыхательной практики: не гасить фонарик сразу при уходе в другое приложение;
   * авто-стоп — на стороне экрана по таймерам / возврату). Если родитель
   * снимает `isActive`, камера гаснет в любом AppState.
   */
  const isRenderActive =
    isActive &&
    (isFocused || appState === "inactive" || appState === "background");
  const isRenderActiveRef = useRef(isRenderActive);
  isRenderActiveRef.current = isRenderActive;
  const isCameraSessionActive = isRenderActive;
  const device = useCameraDevice("back", { physicalDevices: ["wide-angle-camera"] });
  /**
   * Для PPG-камеры выбираем САМОЕ лёгкое возможное разрешение и самый низкий
   * fps, который нам нужен (10 Hz, см. TARGET_PPG_FPS). Мотивация:
   *  - чем меньше пикселей в кадре, тем меньше работы ISP камеры и меньше
   *    внутренних DMA-пересылок в SoC → прямое снижение тепла;
   *  - наш нативный плагин всё равно sample'ит ROI с шагом `PPG_SAMPLE_STRIDE`,
   *    то есть реально трогает несколько сотен пикселей — увеличение
   *    разрешения не даёт никакой точности по PPG, только греет железо;
   *  - fps=10 — см. комментарий у `TARGET_PPG_FPS`.
   *
   * Если конкретное устройство не имеет формата, который выдаёт ровно 10 fps
   * при 640×480, VisionCamera выберет ближайший (по тому же filter-порядку
   * приоритета). Это безопаснее, чем жёстко задавать `fps` без format, т.к.
   * без согласования камера может остаться на 30/60 fps формата по умолчанию.
   */
  /**
   * Максимальный fps для этой ссесии: HIGH_PRECISION_PPG_FPS в warmup/QC,
   * TARGET_PPG_FPS в обычном running. Формат камеры подбираем под
   * верхнюю границу — иначе VisionCamera на некоторых прошивках выберет
   * формат на 30 fps и будет расходовать ISP впустую, игнорируя fps-лимит.
   */
  const effectiveMaxFps = captureRateHint === "highPrecision" ? HIGH_PRECISION_PPG_FPS : TARGET_PPG_FPS;
  /** В silent — один кадр в секунду: минимальная нагрузка ISP при живой сессии и torch. */
  const formatTargetFps = silent ? 1 : effectiveMaxFps;
  const format = useCameraFormat(device, [
    { videoResolution: { width: 640, height: 480 } },
    { fps: formatTargetFps },
  ]);
  /** VisionCamera включает torch только когда сессия активна (у нас всегда так при `isRenderActive`). */
  const shouldEnableTorchViaVisionCamera =
    isCameraSessionActive && cameraReady && torchArmed && Boolean(device?.hasTorch);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (s) => setAppState(s));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isCameraSessionActive) {
      setTorchArmed(false);
      setCameraReady(false);
      return;
    }
    pipeline.setPulseSource("fingerCamera");
    const t = setTimeout(() => setTorchArmed(true), TORCH_ARM_DELAY_MS);
    return () => clearTimeout(t);
  }, [isCameraSessionActive, cameraReady, pipeline]);

  /**
   * Снижаем яркость задней вспышки для PPG-замера. Уровень зависит от
   * `captureRateHint`:
   *  - highPrecision (warmup/QC) — `TORCH_LEVEL_ACTIVATION` (0.35): тот
   *    же уровень, что и в running. Попытки поднимать активацию выше
   *    (0.45–0.55) приводили к пересвету ROI у пользователей с тонкой
   *    кожей и давали «симметричный шум» вместо пульсовой волны.
   *  - normal (running) — `TORCH_LEVEL_RUNNING` (0.35): исторически
   *    проверенный baseline (commit 433bade), на котором пульс
   *    захватывался за 5 секунд.
   *
   * По умолчанию VisionCamera при torch="on" включает вспышку на 100 %.
   * Светодиод на такой мощности даёт избыточно яркий свет и в долгих
   * сессиях — источник ТЕПЛА: сам LED + его регулятор + теплоотдача
   * корпуса.
   *
   * Применяем level ПОСЛЕ того как VisionCamera включил torch (через
   * задержку, т.к. VisionCamera использует свой lockForConfiguration):
   * при ~750 мс сессия уже стабильно активна, и наш вызов
   * `setTorchModeOn(level:)` поверх проходит.
   *
   * Периодически «подтверждаем» уровень: некоторые прошивки iOS могут
   * сбросить torch-level обратно при ре-конфигурации сессии (например,
   * при авто-фокусе или изменении формата). 5-секундный heartbeat
   * стоит почти ничего и гарантирует, что тепловой профиль LED
   * остаётся стабильным всю практику.
   *
   * Почему 0.35 вместо 0.25 (предыдущий эксперимент): при охлаждённых
   * пальцах (только что с улицы) или естественной вазоконстрикции 0.25
   * светодиода не хватает, чтобы свет уверенно пробил палец — PPG
   * получается шумный, пульс «плавает» (49 → 89 → 40). 0.35 — безопасный
   * уровень, стабильный в реальных сценариях.
   */
  const torchLevel =
    captureRateHint === "highPrecision" ? TORCH_LEVEL_ACTIVATION : TORCH_LEVEL_RUNNING;
  useEffect(() => {
    if (!shouldEnableTorchViaVisionCamera) return;
    let cancelled = false;
    const applyLevel = () => {
      if (cancelled) return;
      void setBackTorchLevel(torchLevel);
    };
    const initialTimer = setTimeout(applyLevel, TORCH_NATIVE_LEVEL_DELAY_MS);
    const heartbeat = setInterval(applyLevel, 5_000);
    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(heartbeat);
    };
  }, [shouldEnableTorchViaVisionCamera, torchLevel]);

  /**
   * При unmount всегда гасим torch (даже если дебаунс «выкл при inactive» не успел).
   */
  useEffect(() => {
    return () => {
      void turnOffBackTorch();
    };
  }, []);

  /**
   * При длительном `isActive=false` гасим torch с дебаунсом — иначе краткие
   * мигания `isRenderActive` дают гонку: наш `turnOffBackTorch` + VC `torch="on"`.
   */
  useEffect(() => {
    if (isRenderActive) return;
    const id = setTimeout(() => {
      if (isRenderActiveRef.current) return;
      void turnOffBackTorch();
    }, TURN_OFF_TORCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [isRenderActive]);

  useEffect(() => {
    if (!isCameraSessionActive) {
      permissionRequestedRef.current = false;
      setShowOpenSettingsHint(false);
      return;
    }
    if (hasPermission) {
      setShowOpenSettingsHint(false);
      return;
    }
    if (permissionRequestedRef.current) return;
    permissionRequestedRef.current = true;
    void requestPermission().then((granted) => {
      if (!granted) setShowOpenSettingsHint(true);
    });
  }, [isCameraSessionActive, hasPermission, requestPermission]);

  /**
   * Стабильная ref-обёртка над `onFrameStats`, чтобы родитель мог менять
   * колбэк без пересоздания worklet-моста (который дорогой, см.
   * комментарий к React.memo).
   */
  const onFrameStatsRef = useRef<typeof onFrameStats>(onFrameStats);
  onFrameStatsRef.current = onFrameStats;

  // Один раз на монтирование создаём стабильный мост «worklet → JS».
  // `reportFrame` ссылочно не меняется, поэтому useFrameProcessor ниже тоже
  // построит processor ровно один раз.
  const reportFrame = useMemo(() => {
    const handleFrame = (
      _width: number,
      _height: number,
      _pixelFormat: string | undefined,
      fingerSample: FingerFrameProcessorResult | null,
      processingMs: number,
    ) => {
      if (!cameraReadyRef.current) {
        cameraReadyRef.current = true;
        setCameraReady(true);
      }
      const cb = onFrameStatsRef.current;
      if (cb && processingMs > 0) {
        cb({ processingMs, receivedAtMs: Date.now() });
      }
      if (fingerSample == null) return;
      pipelineRef.current.pushOpticalSample(fingerSample);
    };
    return Worklets.createRunOnJS(handleFrame);
    // Worklets из require() стабилен между рендерами; создаём мост один раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cameraReadyRef = useRef(false);

  /**
   * SharedValue для worklet-gate: когда `silent=true`, worklet немедленно
   * выходит без вызова `analyzeFingerRoi` и без JSI-переправки в JS.
   *
   * Почему SharedValue, а не prop:
   *  - prop внутри worklet'а читается как «значение в момент замыкания»,
   *    т.е. чтобы менять поведение worklet'а без пересоздания frame
   *    processor'а, нужен именно разделяемый value;
   *  - пересоздавать frame processor при каждом переключении silent-режима
   *    — это как раз то, чего мы избегаем (см. комментарий к React.memo
   *    выше, проблема с «накопительным» торможением от лишних worklet-мостов);
   *  - SharedValue из worklets-core читается в обоих контекстах (JS и
   *    worklet) без синхронизации.
   */
  const silentMode = useMemo(() => Worklets.createSharedValue(false), [Worklets]);
  useEffect(() => {
    silentMode.value = silent;
  }, [silent, silentMode]);

  /**
   * SharedValue для динамического target fps в worklet. Аналогично
   * silentMode: нельзя менять frame processor при переходе warmup→running,
   * чтобы не пересоздавать worklet-мост. `runAtTargetFps(value)` читает
   * из SharedValue и меняет частоту вызова callback'а без пересоздания
   * processor'а.
   */
  const targetFpsSV = useMemo(() => Worklets.createSharedValue(TARGET_PPG_FPS), [Worklets]);
  useEffect(() => {
    targetFpsSV.value = effectiveMaxFps;
  }, [effectiveMaxFps, targetFpsSV]);

  /**
   * Частота обработки PPG. См. константы `TARGET_PPG_FPS` и `PPG_SAMPLE_STRIDE`
   * на уровне модуля для подробной истории и обоснования.
   *
   * Сводно:
   *  - `fps={[1, TARGET_PPG_FPS]}` на `<Camera>` — ограничивает камеру физически:
   *    ISP не обрабатывает лишние кадры, видеоэнкодер работает реже, тепло на
   *    задней части телефона падает.
   *  - `runAtTargetFps(TARGET_PPG_FPS, ...)` внутри worklet'а — страховка
   *    на случай, если конкретный формат камеры не умеет точно 15 Hz и
   *    отдаёт чуть больше; лишние кадры просто не попадут в JS-pipeline.
   *  - `roiScale: 0.34, sampleStride: PPG_SAMPLE_STRIDE` — нативный плагин
   *    трогает только центральный квадрат ROI и берёт только каждый 6-й
   *    пиксель внутри него.
   *  - в `silent` мы **снимаем frameProcessor с `<Camera>` вообще**
   *    (см. проп `frameProcessor={silent ? undefined : frameProcessor}` ниже).
   *    Это важнее, чем ранний выход из worklet'а: без frame processor'а
   *    VisionCamera не поднимает worker-thread и не гоняет YUV-буферы через
   *    JSI-мост в worklet. Capture session остаётся активной (для удержания
   *    фонарика), но полностью «немой» — ISP просто поддерживает связь с
   *    сенсором, без постоянных аллокаций.
   */
  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      // silentMode осталась как safety net на случай race-condition между
      // сменой prop'а silent и применением фильтра — но главный механизм
      // выключения frame pipeline теперь — снятие frameProcessor целиком
      // у <Camera> при silent=true (см. JSX ниже).
      if (silentMode.value) return;
      runAtTargetFps(targetFpsSV.value, () => {
        "worklet";
        const t0 = Date.now();
        const fingerSample = analyzeFingerRoi(frame, { roiScale: 0.34, sampleStride: PPG_SAMPLE_STRIDE });
        const processingMs = Date.now() - t0;
        reportFrame(frame.width, frame.height, frame.pixelFormat, fingerSample, processingMs);
      });
    },
    [reportFrame, silentMode, targetFpsSV],
  );

  if (!isFingerFrameProcessorAvailable()) return null;
  if (!device) return null;

  if (!hasPermission) {
    const gateStyle = visible ? style : [styles.hiddenCamera, style];
    return (
      <View style={gateStyle as ViewStyle} pointerEvents="box-none">
        {showOpenSettingsHint ? (
          <View style={styles.permissionHint} pointerEvents="auto">
            <Text style={styles.permissionHintText}>
              Нужен доступ к камере для измерения пульса. Разрешите камеру в настройках.
            </Text>
            <Pressable
              onPress={() => void Linking.openSettings()}
              style={styles.permissionHintBtn}
              accessibilityRole="button"
            >
              <Text style={styles.permissionHintBtnText}>Открыть настройки</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  const containerStyle = visible ? style : [styles.hiddenCamera, style];

  return (
    <View style={containerStyle as ViewStyle} pointerEvents="none">
      <Camera
        style={visible ? styles.cameraVisible : styles.camera}
        device={device}
        format={format}
        isActive={isCameraSessionActive}
        torch={shouldEnableTorchViaVisionCamera ? "on" : "off"}
        // В silent (emulated-фаза гибрида) мы полностью снимаем frame processor:
        // VisionCamera не поднимает worker-thread, не шлёт YUV-кадры в worklet
        // через JSI-мост, не триггерит Skia preview pipeline. Capture session
        // при этом остаётся активной (чтобы iOS стабильно держал фонарик —
        // см. JSDoc у prop `silent`). Это радикально снижает тепловой бюджет
        // emulated-фазы: остаётся только минимально-нужный ISP poll при fps=1.
        frameProcessor={silent ? undefined : frameProcessor}
        photo={false}
        video={false}
        audio={false}
        pixelFormat="yuv"
        // fps задаём диапазоном [minFps, maxFps], а не фиксированным числом:
        //  - при хорошем освещении (а у нас включён торч) камера выберет
        //    верхнюю границу — 15 Hz;
        //  - если формат по какой-то причине не умеет ровно 15 Hz,
        //    VisionCamera возьмёт ближайшее из диапазона (обычно 10 или 12);
        //  - если формат поддерживает ≤ 15 только «от», диапазон позволяет
        //    гладко деградировать без runtime-ошибки.
        // В silent — строго 1 fps (см. `formatTargetFps`); иначе — до effectiveMaxFps.
        fps={silent ? [1, 1] : [1, effectiveMaxFps]}
        onStarted={() => setCameraReady(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hiddenCamera: {
    position: "absolute",
    width: 2,
    height: 2,
    opacity: 0.02,
    overflow: "hidden",
    left: 0,
    top: 0,
    zIndex: 0,
  },
  camera: {
    width: 400,
    height: 400,
  },
  cameraVisible: {
    width: "100%",
    height: "100%",
  },
  permissionHint: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 120,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(28,28,30,0.96)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    zIndex: 50,
  },
  permissionHintText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  permissionHintBtn: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  permissionHintBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});

/**
 * Экспортируем memo-версию. Пропсы сравниваются поверхностно: `isActive` и
 * `visible` — примитивы, `style` обычно стабилен. Это отсекает лишние рендеры
 * от родителя без поломки контракта API.
 */
export const FingerPpgCameraSource = memo(FingerPpgCameraSourceImpl);
