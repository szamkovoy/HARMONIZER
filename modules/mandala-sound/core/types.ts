import type { AudioMetadata } from "expo-audio";

import type { PlannedCycle } from "@/modules/breath/core/breath-phase-planner";
import type { AudioBandTrigger } from "@/modules/mandala/core/types";
import type { SoundBedId } from "@/modules/mandala-sound/core/soundBed";

export type MandalaSoundBand = "beta" | AudioBandTrigger["id"];

export type MandalaSoundPracticeKind = "breath" | "meditation";

/** Lock-screen / media-notification card shown while a background practice runs. */
export interface MandalaSoundLockScreen {
  /** Localized now-playing title (e.g. «Спокойствие»). */
  title: string;
  /** `require()`'d cover image — same art shown on the practice screen. */
  artwork: number;
}

export interface MandalaSoundSessionInput {
  practiceKind: MandalaSoundPracticeKind;
  durationMs: number;
  chakra?: number;
  isActive: boolean;
  plannedCycle?: PlannedCycle | null;
  cycleStartMs?: number | null;
  /** Exclusive bed: neuro-sync (default) or a nature ambient loop. */
  soundBed?: SoundBedId;
  /** Keep audio playing when the screen sleeps (Calm practice). */
  staysActiveInBackground?: boolean;
  /**
   * When set (with `staysActiveInBackground`), bind the audio to the OS
   * media-notification / lock-screen card. On Android this is what keeps the
   * foreground service alive for sustained background playback (without it
   * Android stops the audio after ~3 minutes in Doze).
   */
  lockScreen?: MandalaSoundLockScreen;
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
  start(
    chakra: number,
    options?: {
      staysActiveInBackground?: boolean;
      lockScreenMetadata?: AudioMetadata;
      onPlaybackStateChange?: (playing: boolean) => void;
    },
  ): Promise<void>;
  update(frame: MandalaSoundSyncFrame): Promise<void>;
  stop(options?: { fadeOutMs?: number }): Promise<void>;
}
