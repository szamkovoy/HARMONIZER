import type { BioSignalFrame, BioSignalSource } from "@/modules/mandala/core/types";

import type { BiofeedbackFrame, BiofeedbackSourceKind } from "@/modules/biofeedback/core/types";
import {
  normalizeBreathRate,
  normalizePulseRate,
  normalizeRmssd,
  normalizeStressIndex,
} from "@/modules/biofeedback/core/metrics";

function toMandalaSource(source: BiofeedbackSourceKind): BioSignalSource {
  switch (source) {
    case "fingerCamera":
      return "fingerPpg";
    case "faceCamera":
      return "faceRppg";
    case "health":
      return "health";
    case "wearable":
      return "wearable";
    case "simulated":
    default:
      return "simulated";
  }
}

export function toMandalaBioSignalFrame(frame: BiofeedbackFrame): BioSignalFrame {
  return {
    breathPhase: frame.breathPhase,
    pulsePhase: frame.pulsePhase,
    breathRate: normalizeBreathRate(frame.breathRateBpm),
    pulseRate: normalizePulseRate(frame.pulseRateBpm),
    rmssd: normalizeRmssd(frame.rmssdMs),
    stressIndex: normalizeStressIndex(frame.stressIndex),
    signalQuality: Math.min(1, Math.max(0, frame.signalQuality)),
    source: toMandalaSource(frame.source),
  };
}
