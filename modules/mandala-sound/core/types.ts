import type { PlannedCycle } from "@/modules/breath/core/breath-phase-planner";
import type { AudioBandTrigger } from "@/modules/mandala/core/types";
import type { SoundBedId } from "@/modules/mandala-sound/core/soundBed";

export type MandalaSoundBand = "beta" | AudioBandTrigger["id"];

export type MandalaSoundPracticeKind = "breath" | "meditation";

export interface MandalaSoundSessionInput {
  practiceKind: MandalaSoundPracticeKind;
  durationMs: number;
  chakra?: number;
  isActive: boolean;
  plannedCycle?: PlannedCycle | null;
  cycleStartMs?: number | null;
  /** Exclusive bed: neuro-sync (default) or a nature ambient loop. */
  soundBed?: SoundBedId;
  /** Keep expo-av playing when the screen sleeps (Calm practice). */
  staysActiveInBackground?: boolean;
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
  binauralGain: number;
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
  /** Binaural loops отсортированы по убыванию beatHz; движок кроссфейдит соседние по targetHz. */
  binaural: readonly MandalaSoundBinauralLoop[];
  gongs: Record<AudioBandTrigger["id"], number>;
}

export interface MandalaSoundBinauralLoop {
  /** Частота бинаурального биения (разность каналов), Гц. Несущая фиксирована 150 Гц. */
  beatHz: number;
  asset: number;
}

export interface MandalaSoundEngineControls {
  start(chakra: number, options?: { staysActiveInBackground?: boolean }): Promise<void>;
  update(frame: MandalaSoundSyncFrame): Promise<void>;
  stop(options?: { fadeOutMs?: number }): Promise<void>;
}
