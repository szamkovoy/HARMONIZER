/**
 * Базовые типы Biofeedback (после рефакторинга 2026).
 *
 * Из этого файла остались только:
 *  - перечисления (BiofeedbackSourceKind, PulseLockState, StressReadinessTier, ...);
 *  - конфигурация захвата (BiofeedbackCaptureConfig + дефолты для finger/face камер);
 *  - диагностические типы пиков (FingerPeakDiagnostic) — используются в `signal/peak-detector.ts`;
 *  - тип тиров HRV (HrvPracticeTier).
 *
 * Удалено:
 *  - `FingerSignalSnapshot` (60 полей) — заменён на узкие типы каналов в `engines/types.ts`;
 *  - `BiofeedbackFrame` — заменён на `BioSignalFrame` мандалы (через MandalaBioFrameAdapter);
 *  - `FingerCameraNativeSample` — теперь `RawOpticalSample` из `sensors/types.ts`;
 *  - `BiofeedbackSensorAdapter` — заменён на `BiofeedbackSensor` в `sensors/types.ts`.
 */

/** Источник биометрии. Расширяется по мере подключения новых сенсоров. */
export type BiofeedbackSourceKind =
  | "fingerCamera"
  | "faceCamera"
  | "simulated"
  | "health"
  | "wearable";

/** Статус сигнала для UI-индикаторов и состояния `signalStatus` в legacy-коде. */
export type BiofeedbackSignalStatus = "searching" | "stable" | "degraded" | "lost";

/** Состояние блокировки пульса. */
export type PulseLockState = "searching" | "tracking" | "holding";

/** Готовность стресс-метрики (по продолжительности накопителя). */
export type StressReadinessTier = "warming" | "fast60" | "stable90";

/** Тиер длительности/качества практики для RMSSD/стресса. */
export type HrvPracticeTier =
  | "none"
  | "beats_30_59"
  | "beats_60_89"
  | "beats_90_119"
  | "beats_120_179"
  | "beats_180_plus";

/** Причина приёма/отклонения пика (для диагностики). */
export type FingerPeakReasonCode =
  | "accepted"
  | "edge_margin"
  | "below_height"
  | "below_prominence"
  | "refractory_replaced"
  | "refractory_weaker";

/** Какой канал оптики используется (legacy: для совместимости с UI диаграммами). */
export type OpticalChannel = "redMean" | "greenMean" | "luma";

/** Полоса частот (для конфигурации фильтров). */
export interface FrequencyBand {
  minHz: number;
  maxHz: number;
}

/** Конфигурация захвата сигнала источником. */
export interface BiofeedbackCaptureConfig {
  source: Extract<BiofeedbackSourceKind, "fingerCamera" | "faceCamera">;
  targetFps: number;
  requiresTorch: boolean;
  pulseBand: FrequencyBand;
  breathBand: FrequencyBand;
  minPulseBpm: number;
  maxPulseBpm: number;
  minBreathBpm: number;
  maxBreathBpm: number;
}

/** Диагностика пика (используется внутри signal/peak-detector + опционально в экспорте). */
export interface FingerPeakDiagnostic {
  sampleIndex: number;
  timestampMs: number;
  value: number;
  prominence: number;
  reasonCode: FingerPeakReasonCode;
}

/** Дефолтная конфигурация для finger PPG (задняя камера + вспышка). */
export const FINGER_CAMERA_CAPTURE_CONFIG: BiofeedbackCaptureConfig = {
  source: "fingerCamera",
  targetFps: 30,
  requiresTorch: true,
  pulseBand: { minHz: 0.75, maxHz: 4.0 },
  breathBand: { minHz: 0.08, maxHz: 0.6 },
  minPulseBpm: 40,
  maxPulseBpm: 180,
  minBreathBpm: 5,
  maxBreathBpm: 30,
};

/** Дефолтная конфигурация для face rPPG (фронтальная камера, без вспышки). Скаффолд. */
export const FACE_CAMERA_CAPTURE_CONFIG: BiofeedbackCaptureConfig = {
  source: "faceCamera",
  targetFps: 30,
  requiresTorch: false,
  pulseBand: { minHz: 0.75, maxHz: 3.5 },
  breathBand: { minHz: 0.08, maxHz: 0.5 },
  minPulseBpm: 40,
  maxPulseBpm: 180,
  minBreathBpm: 5,
  maxBreathBpm: 30,
};
