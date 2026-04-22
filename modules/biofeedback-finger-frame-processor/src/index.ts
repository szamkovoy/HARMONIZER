import { requireOptionalNativeModule } from "expo-modules-core";
import { VisionCameraProxy, type Frame } from "react-native-vision-camera";

/**
 * TAG_ANDROID_ADAPTATION
 *
 * Этот индекс-файл завязан на нативный модуль `BiofeedbackFingerFrameProcessor`,
 * который сейчас реализован только под iOS. Все wrapper-функции ниже
 * (`setBackTorchLevel`, `turnOffBackTorch`, `getThermalState`,
 * `subscribeThermalState`, `getNativeMemoryMb`, `getBatteryLevelPct`)
 * используют pattern "null-safe probe": если нативная функция отсутствует,
 * возвращают `null`/`false`. Поэтому на Android код не ломается, а
 * просто деградирует (thermal trigger недоступен, torch level не
 * регулируется). Полный перечень Android-эквивалентов и план работ:
 *   `/docs/android-adaptation-notes.md`
 */

export type ThermalState = "nominal" | "fair" | "serious" | "critical";

type ThermalStateEvent = { state: ThermalState };

type ThermalSubscription = { remove(): void };

type BiofeedbackFingerFrameProcessorNative = {
  setBackTorchLevel?(level: number): Promise<boolean>;
  turnOffBackTorch?(): Promise<boolean>;
  getThermalState?(): Promise<ThermalState>;
  getMemoryUsageMb?(): Promise<number>;
  getBatteryLevelPct?(): Promise<number>;
  addListener?(eventName: string, listener: (event: ThermalStateEvent) => void): ThermalSubscription;
};

const nativeModule = requireOptionalNativeModule<BiofeedbackFingerFrameProcessorNative>(
  "BiofeedbackFingerFrameProcessor",
);

/**
 * Задаёт уровень задней вспышки (torch) для PPG-замеров.
 *
 * Платформенная реализация: iOS вызывает `AVCaptureDevice.setTorchModeOn(level:)`
 * с clamp'ом в [0.05, 1.0]. Android пока игнорируется (возвращает false) —
 * VisionCamera на Android управляет torch только в on/off, и большинство
 * OEM прошивок не дают программный контроль яркости LED через Camera2.
 *
 * Возвращает `true`, если уровень реально применён. `false` — если
 * нативный модуль недоступен, у устройства нет torch, либо не удалось
 * захватить lock (например, пока VisionCamera-сессия не активна).
 */
export async function setBackTorchLevel(level: number): Promise<boolean> {
  if (!nativeModule?.setBackTorchLevel) return false;
  try {
    return await nativeModule.setBackTorchLevel(level);
  } catch {
    return false;
  }
}

export async function turnOffBackTorch(): Promise<boolean> {
  if (!nativeModule?.turnOffBackTorch) return false;
  try {
    return await nativeModule.turnOffBackTorch();
  } catch {
    return false;
  }
}

/**
 * Возвращает текущий уровень теплового состояния (iOS ProcessInfo.thermalState).
 *
 * Уровни: "nominal" | "fair" | "serious" | "critical".
 *  - `nominal` — троттлинга нет.
 *  - `fair` — ОС готовится снижать частоты CPU/GPU (первый «звонок»).
 *    Гибридный контроллер переключает сессию в эмуляцию пульса на этом
 *    уровне, чтобы предотвратить лаг ДО того, как он станет заметным.
 *  - `serious` — частоты снижены, приложение уже подтормаживает.
 *  - `critical` — экстренное состояние, система может убить процесс.
 *
 * На Android / в симуляторе / при отсутствии native-модуля всегда
 * возвращает `"nominal"`. В таком режиме гибридный контроллер опирается
 * только на временной кэп (см. `hybrid-measurement-controller`).
 */
export async function getThermalState(): Promise<ThermalState> {
  if (!nativeModule?.getThermalState) return "nominal";
  try {
    return await nativeModule.getThermalState();
  } catch {
    return "nominal";
  }
}

/**
 * Подписка на изменения теплового состояния. iOS шлёт событие один раз
 * при переходе между уровнями (nominal ↔ fair ↔ serious ↔ critical).
 *
 * Используется гибридным контроллером для мгновенной реакции: как только
 * система повысила уровень до `fair`, контроллер готов переключать сессию
 * в эмуляцию (если также соблюдены min-time и достаточно данных).
 */
/**
 * Потребление памяти процессом в МБ. На iOS — `task_vm_info.phys_footprint`
 * (ровно то число, что Xcode показывает в Debug Navigator → Memory). На
 * Android / симуляторе без нативного модуля возвращает `null`.
 *
 * Лог диагностики: первый fail (метод отсутствует или бросает) попадает
 * в `console.warn` один раз за процесс — если в Metro видно это сообщение,
 * значит dev-client собран без новых нативных функций и нужен rebuild
 * (`npx expo run:ios --device`). Дальше молчит, чтобы не засорять лог.
 */
let loggedMemDiagFailure = false;
export async function getNativeMemoryMb(): Promise<number | null> {
  if (!nativeModule?.getMemoryUsageMb) {
    if (!loggedMemDiagFailure) {
      loggedMemDiagFailure = true;
      console.warn(
        "[perfDiag] BiofeedbackFingerFrameProcessor.getMemoryUsageMb недоступен — пересоберите dev-client",
      );
    }
    return null;
  }
  try {
    const v = await nativeModule.getMemoryUsageMb();
    if (Number.isFinite(v) && v > 0) return v;
    if (!loggedMemDiagFailure) {
      loggedMemDiagFailure = true;
      console.warn(`[perfDiag] getMemoryUsageMb вернул нерабочее значение: ${v}`);
    }
    return null;
  } catch (err) {
    if (!loggedMemDiagFailure) {
      loggedMemDiagFailure = true;
      console.warn("[perfDiag] getMemoryUsageMb бросил исключение:", err);
    }
    return null;
  }
}

/**
 * Уровень заряда батареи в процентах [0..100]. iOS читает `UIDevice.batteryLevel`
 * с main-thread (без этого возвращал `-1.0` → `null`). Дискретность на iOS
 * ~5%, но по 20-минутной практике даёт полезную оценку энергобюджета.
 *
 * При первом сбое пишет в `console.warn` (см. `getNativeMemoryMb` — та же идея).
 */
let loggedBatteryDiagFailure = false;
export async function getBatteryLevelPct(): Promise<number | null> {
  if (!nativeModule?.getBatteryLevelPct) {
    if (!loggedBatteryDiagFailure) {
      loggedBatteryDiagFailure = true;
      console.warn(
        "[perfDiag] BiofeedbackFingerFrameProcessor.getBatteryLevelPct недоступен — пересоберите dev-client",
      );
    }
    return null;
  }
  try {
    const v = await nativeModule.getBatteryLevelPct();
    if (Number.isFinite(v) && v >= 0) return v;
    if (!loggedBatteryDiagFailure) {
      loggedBatteryDiagFailure = true;
      console.warn(`[perfDiag] getBatteryLevelPct вернул нерабочее значение: ${v}`);
    }
    return null;
  } catch (err) {
    if (!loggedBatteryDiagFailure) {
      loggedBatteryDiagFailure = true;
      console.warn("[perfDiag] getBatteryLevelPct бросил исключение:", err);
    }
    return null;
  }
}

export function subscribeThermalState(
  listener: (state: ThermalState) => void,
): { remove(): void } {
  if (!nativeModule?.addListener) {
    return { remove() {} };
  }
  const subscription = nativeModule.addListener("onThermalStateChanged", (event) => {
    listener(event.state);
  });
  return {
    remove() {
      subscription.remove();
    },
  };
}

export type FingerFrameProcessorOptions = {
  roiScale?: number;
  sampleStride?: number;
};

export type FingerFrameProcessorResult = {
  timestampMs: number;
  width: number;
  height: number;
  redMean: number;
  greenMean: number;
  blueMean: number;
  lumaMean: number;
  redDominance: number;
  darknessRatio: number;
  saturationRatio: number;
  motion: number;
  sampleCount: number;
  roiAreaRatio: number;
};

const fingerFrameProcessorPlugin = VisionCameraProxy.initFrameProcessorPlugin("analyzeFingerRoi", {});

export function isFingerFrameProcessorAvailable() {
  return fingerFrameProcessorPlugin != null;
}

export function analyzeFingerRoi(
  frame: Frame,
  options: FingerFrameProcessorOptions = {},
): FingerFrameProcessorResult | null {
  "worklet";

  if (fingerFrameProcessorPlugin == null) {
    return null;
  }

  return fingerFrameProcessorPlugin.call(frame, options) as FingerFrameProcessorResult | null;
}
