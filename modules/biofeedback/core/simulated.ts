import type { BiofeedbackFrame, BiofeedbackSourceKind } from "@/modules/biofeedback/core/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createSimulatedBiofeedbackFrame(
  elapsedSeconds: number,
  preferredSource: Extract<BiofeedbackSourceKind, "fingerCamera" | "faceCamera"> = "fingerCamera",
): BiofeedbackFrame {
  const breathHz = 0.26 + 0.015 * Math.sin(elapsedSeconds * 0.11);
  const pulseHz = 1.08 + 0.035 * Math.sin(elapsedSeconds * 0.23 + 0.9);
  const breathPhase = 0.5 + 0.5 * Math.sin(elapsedSeconds * Math.PI * 2 * breathHz);
  const pulsePhase = 0.5 + 0.5 * Math.sin(elapsedSeconds * Math.PI * 2 * pulseHz);
  const rmssdMs = clamp(52 + 10 * Math.sin(elapsedSeconds * 0.18) - 4 * Math.cos(elapsedSeconds * 0.33), 20, 120);
  const stressIndex = clamp(38 - 9 * Math.sin(elapsedSeconds * 0.21) + 5 * Math.cos(elapsedSeconds * 0.09), 5, 95);

  return {
    timestampMs: Math.round(elapsedSeconds * 1000),
    source: "simulated",
    signalStatus: "stable",
    signalQuality: preferredSource === "fingerCamera" ? 0.7 : 0.56,
    pulsePhase,
    pulseRateBpm: pulseHz * 60,
    breathPhase,
    breathRateBpm: breathHz * 60,
    rmssdMs,
    baevskyStressIndexRaw: 50 + (stressIndex / 100) * (900 - 50),
    stressIndex,
    rrIntervalsMs: [],
  };
}
