export type BiofeedbackSourceKind =
  | "fingerCamera"
  | "faceCamera"
  | "simulated"
  | "health"
  | "wearable";

export type BiofeedbackSignalStatus = "searching" | "stable" | "degraded" | "lost";
export type PulseLockState = "searching" | "tracking" | "holding";
export type StressReadinessTier = "warming" | "fast60" | "stable90";

/** Тир длительности/качества практики для RMSSD/стресса (накопитель валидных ударов). */
export type HrvPracticeTier =
  | "none"
  | "beats_30_59"
  | "beats_60_89"
  | "beats_90_119"
  | "beats_120_179"
  | "beats_180_plus";
export type FingerPeakReasonCode =
  | "accepted"
  | "edge_margin"
  | "below_height"
  | "below_prominence"
  | "refractory_replaced"
  | "refractory_weaker";

export type OpticalChannel = "redMean" | "greenMean" | "luma";

export interface FrequencyBand {
  minHz: number;
  maxHz: number;
}

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

export interface OpticalSignalSample {
  timestampMs: number;
  channel: OpticalChannel;
  value: number;
  quality: number;
}

export interface FingerPeakDiagnostic {
  sampleIndex: number;
  timestampMs: number;
  value: number;
  prominence: number;
  reasonCode: FingerPeakReasonCode;
}

export interface FingerCameraNativeSample {
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
}

export interface FingerSignalSnapshot {
  timestampMs: number;
  sampleCount: number;
  signalStatus: BiofeedbackSignalStatus;
  signalQuality: number;
  fingerDetected: boolean;
  fingerPresenceConfidence: number;
  pulseReady: boolean;
  /** Завершена ли калибровка: 10 с прогрева + 10 с окна проверки. */
  pulseCalibrationComplete: boolean;
  pulseWindowSeconds: number;
  pulseLockState: PulseLockState;
  pulseLockConfidence: number;
  rawPulseRateBpm: number;
  rmssdReady: boolean;
  rmssdWindowSeconds: number;
  rawRmssdMs: number;
  hrvConfidence: number;
  stressReady: boolean;
  stressWindowSeconds: number;
  stressTier: StressReadinessTier;
  opticalValue: number;
  /** Сколько миллисекунд палец на сенсоре накоплено (монотонно, пока контакт есть). */
  fingerContactElapsedMs: number;
  baseline: number;
  detrendedValue: number;
  /** Последнее значение после bandpass (0.8–2.5 Hz) + лёгкое сглаживание — то, что идёт в детектор пиков. */
  ppgBandpassedValue: number;
  pulseRateBpm: number;
  breathRateBpm: number;
  pulsePhase: number;
  breathPhase: number;
  rmssdMs: number;
  baevskyStressIndexRaw: number;
  stressIndex: number;
  rrIntervalsMs: number[];
  /** Абсолютные метки ударов (мс), для HRV/когерентности — тот же merged-поток, что и для RR. */
  beatTimestampsMs: readonly number[];
  rawRrIntervalsMs: number[];
  medianRrMs: number;
  rawBaevskyStressIndexRaw: number;
  detectedBeatCount: number;
  candidatePeakCount: number;
  acceptedPeakCount: number;
  rejectedPeakCount: number;
  candidatePeaks: FingerPeakDiagnostic[];
  acceptedPeaks: FingerPeakDiagnostic[];
  rejectedPeaks: FingerPeakDiagnostic[];
  opticalSamples: OpticalSignalSample[];
  redMean: number;
  greenMean: number;
  blueMean: number;
  lumaMean: number;
  redDominance: number;
  darknessRatio: number;
  saturationRatio: number;
  motion: number;
  /** Число валидных ударов в накопителе HRV (после калибровки). */
  hrvEligibleBeatCount: number;
  /** Удары вне tracking (условно «экстраполяция» / holding-контекст). */
  hrvExtrapolatedBeatCount: number;
  hrvMinDisplayEligibleBeats: number;
  /** Верхняя граница для «длинной» практики (начало/конец сессии). */
  hrvMinFullEligibleBeats: number;
  hrvPracticeTier: HrvPracticeTier;
  hrvRmssdApproximate: boolean;
  hrvStressApproximate: boolean;
  hrvShowInitialFinal: boolean;
  hrvInitialRmssdMs: number;
  hrvInitialStressIndex: number;
  hrvFinalRmssdMs: number;
  hrvFinalStressIndex: number;
  /** Зафиксировано при переходе «палец был → палец снят» (средние начало/конец на момент снятия). */
  hrvSessionEndCaptured: boolean;
  hrvSessionEndInitialRmssdMs: number;
  hrvSessionEndFinalRmssdMs: number;
  hrvSessionEndInitialStressIndex: number;
  hrvSessionEndFinalStressIndex: number;
}

export interface BiofeedbackFrame {
  timestampMs: number;
  source: BiofeedbackSourceKind;
  signalStatus: BiofeedbackSignalStatus;
  signalQuality: number;
  pulsePhase: number;
  pulseRateBpm: number;
  breathPhase: number;
  breathRateBpm: number;
  rmssdMs: number;
  baevskyStressIndexRaw: number;
  stressIndex: number;
  rrIntervalsMs: number[];
}

export interface BiofeedbackStreamHandle {
  stop(): Promise<void>;
}

export interface BiofeedbackSensorAdapter {
  readonly source: BiofeedbackSourceKind;
  start(
    config: BiofeedbackCaptureConfig,
    onFrame: (frame: BiofeedbackFrame) => void,
  ): Promise<BiofeedbackStreamHandle>;
}

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
