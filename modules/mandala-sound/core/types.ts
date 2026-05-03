import type { PlannedCycle } from "@/modules/breath/core/breath-phase-planner";
import type { AudioBandTrigger } from "@/modules/mandala/core/types";

export type MandalaSoundBand = "beta" | AudioBandTrigger["id"];

export type MandalaSoundPracticeKind = "breath" | "meditation";

export interface MandalaSoundSessionInput {
  practiceKind: MandalaSoundPracticeKind;
  durationMs: number;
  chakra?: number;
  isActive: boolean;
  plannedCycle?: PlannedCycle | null;
  cycleStartMs?: number | null;
}

export interface MandalaSoundBreathSync {
  phase: number;
  phaseKind: "inhale" | "exhale" | "hold" | "idle";
  phaseIndex: number;
  fractionInPhase: number;
}

export interface MandalaSoundPulseSync {
  phase: number;
  confidence: number;
  source: "detected" | "extrapolated" | "fallback";
}

export interface MandalaSoundSyncFrame {
  nowMs: number;
  elapsedMs: number;
  durationMs: number;
  targetHz: number;
  band: MandalaSoundBand;
  breath: MandalaSoundBreathSync;
  pulse: MandalaSoundPulseSync;
  textureBrightness: number;
  droneGain: number;
  textureGain: number;
  flickerHz: number;
  flickerIntensity: number;
  gongTrigger: AudioBandTrigger["id"] | null;
}

export interface MandalaSoundVisualSync {
  flickerHz: number;
  flickerIntensity: number;
  breathPhase: number;
  pulsePhase: number;
}

export interface MandalaSoundAssetPreset {
  drones: readonly number[];
  textures: readonly number[];
  gongs: Record<AudioBandTrigger["id"], number>;
  events: readonly number[];
}

export interface MandalaSoundEngineControls {
  start(chakra: number): Promise<void>;
  update(frame: MandalaSoundSyncFrame): Promise<void>;
  stop(): Promise<void>;
}
