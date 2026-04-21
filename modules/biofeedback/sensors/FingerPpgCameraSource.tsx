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
  type FingerFrameProcessorResult,
} from "@/modules/biofeedback-finger-frame-processor/src";
import { useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import type { BiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-pipeline";

type Props = {
  isActive: boolean;
  /** Стиль контейнера камеры. По умолчанию — невидимая 2x2 точка. */
  style?: ViewStyle;
  /** Если true — контейнер камеры отрисовывается обычным размером (для probe-экрана). */
  visible?: boolean;
  /**
   * Если true — камера и фонарик остаются активными (пользователь не замечает
   * разницы), но worklet не вызывает `analyzeFingerRoi` и ничего не шлёт в
   * pipeline. Используется в гибридном режиме измерения на этапе эмуляции
   * пульса: телефон остывает, но визуально всё выглядит как обычная практика.
   */
  silent?: boolean;
};

/**
 * Целевая частота обработки PPG. История эволюции:
 *   30 Hz → 15 Hz → 10 Hz → 15 Hz (возврат к точности в гибридном режиме).
 *
 * Почему 15 Hz — компромисс:
 *  - пульс 40..180 BPM = 0.67..3 Hz (теорема Найквиста требует ≥ 6 Hz);
 *  - 15 Hz даёт 2.5× запас по Найквисту, ошибка квантования RR ≈ 67 мс
 *    (при 10 Hz было 100 мс) — это снижает шум в RMSSD на 50 %;
 *  - peak-детектор с refractory 300 мс получает 4-5 кадров на такт вместо
 *    3 — заметно стабильнее обнаружение пиков при слабом сигнале / лёгких
 *    движениях пальца;
 *  - raw-график PPG у пользователя теперь показывает 15 точек/с вместо 10 —
 *    визуальная различимость пульса и шума возвращается.
 *
 * Почему не 30 Hz (как в самом начале):
 *  - в гибридном режиме реальное PPG работает только 3-8 мин в начале и
 *    4-7 мин в конце, вместо 20 мин подряд. Тепла накапливается меньше,
 *    но всё равно 30 Hz = двойной нагрев против 15 Hz.
 *  - При накоплении ~1000 ударов за практику квантование 67 мс даёт
 *    средне-квадратичную ошибку RMSSD < 5 мс, что ниже разницы между
 *    «нормой» и «повышенным стрессом» (порядка 20-30 мс).
 */
const TARGET_PPG_FPS = 15;

/**
 * Шаг субсэмплинга пикселей в ROI в native frame processor'е.
 * Эволюция: 4 → 6 → 8 → 6 (компромисс в гибридном режиме).
 *
 * При формате 640×480 и roiScale 0.34 размер ROI ≈ 218×163 = 35k пикселей.
 * При stride 6 нативный плагин трогает ~970 пикселей на кадр. Это на 80 %
 * больше, чем при stride 8 (~540), но заметно меньше, чем при stride 4
 * (~2200). В сочетании с Accelerate/vDSP и SIMD-mean за один проход —
 * дешёвая операция даже при 15 Hz.
 *
 * Почему вернулись ближе к stride 4:
 *  - при stride 8 mean по ROI стал заметно шумнее у людей с неоднородной
 *    кожей (веснушки, рубцы): 540 семплов «выхватывали» артефакты;
 *  - stride 6 восстанавливает «мягкость» сигнала при том же SIMD-проходе.
 */
const PPG_SAMPLE_STRIDE = 6;

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
function FingerPpgCameraSourceImpl({ isActive, style, visible = false, silent = false }: Props) {
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

  const isRenderActive = isFocused && appState === "active" && isActive;
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
  const format = useCameraFormat(device, [
    { videoResolution: { width: 640, height: 480 } },
    { fps: TARGET_PPG_FPS },
  ]);
  const shouldEnableTorch = isRenderActive && cameraReady && torchArmed && Boolean(device?.hasTorch);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (s) => setAppState(s));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isRenderActive) {
      setTorchArmed(false);
      return;
    }
    pipeline.setPulseSource("fingerCamera");
    const t = setTimeout(() => setTorchArmed(true), 250);
    return () => clearTimeout(t);
  }, [isRenderActive, cameraReady, pipeline]);

  /**
   * Снижаем яркость задней вспышки до 0.35 для PPG-замера.
   *
   * По умолчанию VisionCamera при torch="on" включает вспышку на 100 %.
   * Светодиод на такой мощности даёт неоправданно яркий свет (палец
   * просвечивается и при 25-40 %) и основной источник ТЕПЛА в
   * долгих сессиях: сам LED + его регулятор + теплоотдача корпуса.
   *
   * Применяем level ПОСЛЕ того как VisionCamera включил torch (через
   * задержку, т.к. VisionCamera использует свой lockForConfiguration):
   * при 500 мс задержке сессия уже стабильно активна, и наш вызов
   * `setTorchModeOn(level:)` поверх проходит.
   *
   * Периодически «подтверждаем» уровень: некоторые прошивки iOS могут
   * сбросить torch-level обратно при ре-конфигурации сессии (например,
   * при авто-фокусе или изменении формата). 5-секундный heartbeat
   * стоит почти ничего и гарантирует, что тепловой профиль LED
   * остаётся стабильно низким всю практику.
   */
  useEffect(() => {
    if (!shouldEnableTorch) return;
    let cancelled = false;
    const applyLevel = () => {
      if (cancelled) return;
      void setBackTorchLevel(0.35);
    };
    const initialTimer = setTimeout(applyLevel, 500);
    const heartbeat = setInterval(applyLevel, 5_000);
    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(heartbeat);
    };
  }, [shouldEnableTorch]);

  useEffect(() => {
    if (!isRenderActive) {
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
  }, [isRenderActive, hasPermission, requestPermission]);

  // Один раз на монтирование создаём стабильный мост «worklet → JS».
  // `reportFrame` ссылочно не меняется, поэтому useFrameProcessor ниже тоже
  // построит processor ровно один раз.
  const reportFrame = useMemo(() => {
    const handleFrame = (
      _width: number,
      _height: number,
      _pixelFormat: string | undefined,
      fingerSample: FingerFrameProcessorResult | null,
    ) => {
      if (!cameraReadyRef.current) {
        cameraReadyRef.current = true;
        setCameraReady(true);
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
   *  - ранний выход по `silentMode.value`: когда гибридный контроллер
   *    перевёл сессию в режим эмуляции, worklet даже не трогает native
   *    плагин — процессор отдыхает, но камера с фонариком остаются
   *    активными, чтобы пользователь ничего не замечал.
   */
  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      if (silentMode.value) return;
      runAtTargetFps(TARGET_PPG_FPS, () => {
        "worklet";
        const fingerSample = analyzeFingerRoi(frame, { roiScale: 0.34, sampleStride: PPG_SAMPLE_STRIDE });
        reportFrame(frame.width, frame.height, frame.pixelFormat, fingerSample);
      });
    },
    [reportFrame, silentMode],
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
        isActive={isRenderActive}
        torch={shouldEnableTorch ? "on" : "off"}
        frameProcessor={frameProcessor}
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
        // `runAtTargetFps(TARGET_PPG_FPS)` в worklet дополнительно ограничит
        // частоту JS-моста, если камера всё же отдаст чуть больше.
        fps={[1, TARGET_PPG_FPS]}
        onInitialized={() => setCameraReady(true)}
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
