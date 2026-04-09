export type BiofeedbackSourceKind =
  | "fingerCamera"
  | "faceCamera"
  | "simulated"
  | "health"
  | "wearable";

export type BiofeedbackSignalStatus = "searching" | "stable" | "degraded" | "lost";

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
