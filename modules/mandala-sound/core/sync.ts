import type { BeatEvent } from "@/modules/biofeedback/sensors/types";
import type { PlannedCycle } from "@/modules/breath/core/breath-phase-planner";
import type {
  MandalaSoundBand,
  MandalaSoundBreathSync,
  MandalaSoundPulseSync,
  MandalaSoundSyncFrame,
} from "@/modules/mandala-sound/core/types";
import { getMandalaSoundBand, getMandalaSoundTargetHz } from "@/modules/mandala-sound/core/timeline";
import { buildAudioContract } from "@/modules/mandala/core/bio";
import type { AudioBandTrigger } from "@/modules/mandala/core/types";

const FALLBACK_BREATH_HZ = 0.33;
const FALLBACK_PULSE_HZ = 1.1;
const PULSE_FALLBACK_AFTER_MS = 2_200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function lfo01(nowMs: number, hz: number): number {
  return 0.5 + 0.5 * Math.sin((nowMs / 1000) * Math.PI * 2 * hz);
}

export function computeBreathSync(
  plannedCycle: PlannedCycle | null | undefined,
  cycleStartMs: number | null | undefined,
  nowMs: number,
): MandalaSoundBreathSync {
  if (!plannedCycle || cycleStartMs == null || plannedCycle.cycleMs <= 0) {
    return {
      phase: lfo01(nowMs, FALLBACK_BREATH_HZ),
      phaseKind: "idle",
      phaseIndex: -1,
      fractionInPhase: 0,
    };
  }

  const tInCycle = ((nowMs - cycleStartMs) % plannedCycle.cycleMs + plannedCycle.cycleMs) % plannedCycle.cycleMs;
  const phaseIndex = plannedCycle.phases.findIndex(
    (phase) => tInCycle >= phase.startMsInCycle && tInCycle < phase.endMsInCycle,
  );
  const active = plannedCycle.phases[phaseIndex] ?? plannedCycle.phases[0];
  if (!active || active.phaseMs <= 0) {
    return {
      phase: lfo01(nowMs, FALLBACK_BREATH_HZ),
      phaseKind: "idle",
      phaseIndex: -1,
      fractionInPhase: 0,
    };
  }

  const fractionInPhase = clamp01((tInCycle - active.startMsInCycle) / active.phaseMs);
  let phase = 0.5;
  if (active.kind === "inhale") {
    phase = fractionInPhase;
  } else if (active.kind === "exhale") {
    phase = 1 - fractionInPhase;
  } else {
    const previous = plannedCycle.phases[Math.max(0, phaseIndex - 1)];
    phase = previous?.kind === "inhale" ? 1 : 0;
  }

  return {
    phase: clamp01(phase),
    phaseKind: active.kind,
    phaseIndex,
    fractionInPhase,
  };
}

export function computePulseSync({
  lastBeat,
  lastRrMs,
  nowMs,
}: {
  lastBeat?: BeatEvent | null;
  lastRrMs?: number | null;
  nowMs: number;
}): MandalaSoundPulseSync {
  const ageMs = lastBeat ? nowMs - lastBeat.timestampMs : Infinity;
  const rrMs = lastRrMs && lastRrMs > 280 && lastRrMs < 2_000 ? lastRrMs : 1_000 / FALLBACK_PULSE_HZ;

  if (lastBeat && ageMs >= 0 && ageMs <= PULSE_FALLBACK_AFTER_MS) {
    return {
      phase: fract(ageMs / rrMs),
      confidence: lastBeat.source === "detected" ? (lastBeat.confidence ?? 0.85) : 0.42,
      source: lastBeat.source,
    };
  }

  return {
    phase: lfo01(nowMs, FALLBACK_PULSE_HZ),
    confidence: 0.24,
    source: "fallback",
  };
}

export function detectGongTransition(
  previousBand: MandalaSoundBand | null,
  currentBand: MandalaSoundBand,
): AudioBandTrigger["id"] | null {
  if (previousBand === currentBand || currentBand === "beta") {
    return null;
  }
  return currentBand;
}

export function buildMandalaSoundFrame({
  startedAtMs,
  nowMs,
  durationMs,
  plannedCycle,
  cycleStartMs,
  lastBeat,
  lastRrMs,
  previousBand,
  hueMain = 220,
  zoomVelocity = 0.35,
}: {
  startedAtMs: number;
  nowMs: number;
  durationMs: number;
  plannedCycle?: PlannedCycle | null;
  cycleStartMs?: number | null;
  lastBeat?: BeatEvent | null;
  lastRrMs?: number | null;
  previousBand: MandalaSoundBand | null;
  hueMain?: number;
  zoomVelocity?: number;
}): MandalaSoundSyncFrame {
  const elapsedMs = clamp(nowMs - startedAtMs, 0, Math.max(1, durationMs));
  const targetHz = getMandalaSoundTargetHz(elapsedMs, durationMs);
  const band = getMandalaSoundBand(targetHz);
  const breath = computeBreathSync(plannedCycle, cycleStartMs, nowMs);
  const pulse = computePulseSync({ lastBeat, lastRrMs, nowMs });
  const contract = buildAudioContract(targetHz, hueMain, zoomVelocity);
  const pulseWave = Math.sin(pulse.phase * Math.PI * 2);
  const breathBrightness = clamp01(0.24 + breath.phase * 0.76);
  const pulseDepth = pulse.source === "detected" ? 0.028 : pulse.source === "extrapolated" ? 0.014 : 0.008;

  return {
    nowMs,
    elapsedMs,
    durationMs,
    targetHz,
    band,
    breath,
    pulse,
    textureBrightness: clamp01(contract.textureBrightness * 0.55 + breathBrightness * 0.45),
    droneGain: clamp01(0.16 + pulseWave * pulseDepth),
    textureGain: clamp01(0.025 + breathBrightness * 0.105),
    binauralGain: clamp01(0.035 + (1 - breath.phase) * 0.018),
    flickerHz: targetHz,
    flickerIntensity: clamp01(0.14 + breath.phase * 0.12 + pulse.confidence * 0.06),
    gongTrigger: detectGongTransition(previousBand, band),
  };
}
