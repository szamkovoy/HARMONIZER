import type {
  AudioBandTrigger,
  BioSignalFrame,
  BioSimConfig,
  MandalaAudioContract,
} from "@/modules/mandala-visual-core/core/types";

export const AUDIO_BAND_TRIGGERS: AudioBandTrigger[] = [
  { id: "alpha", minHz: 8, maxHz: 13, gongVariant: "small" },
  { id: "theta", minHz: 4, maxHz: 8, gongVariant: "medium" },
  { id: "delta", minHz: 0.5, maxHz: 4, gongVariant: "large" },
];

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizeRange(
  value: number,
  min: number,
  max: number,
): number {
  if (max <= min) {
    return 0;
  }
  return clamp01((value - min) / (max - min));
}

export function createBioSimFrame(
  elapsedSeconds: number,
  config: BioSimConfig,
): BioSignalFrame {
  if (!config.enabled) {
    return {
      breathPhase: 0.5,
      pulsePhase: 0.5,
      breathRate: clamp01((0.33 * 60 - 5) / 25),
      pulseRate: clamp01((1.1 * 60 - 40) / 140),
      hrv: clamp01(config.hrvBase),
      stressIndex: clamp01(config.stressBase),
      signalQuality: 0.35,
      source: "offline",
    };
  }

  const breathWave = 0.5 + 0.5 * Math.sin(elapsedSeconds * Math.PI * 2 * config.breathHz);
  const pulseWave = 0.5 + 0.5 * Math.sin(elapsedSeconds * Math.PI * 2 * config.pulseHz);
  const hrv =
    clamp01(
      config.hrvBase +
        0.12 * Math.sin(elapsedSeconds * config.breathHz * Math.PI) -
        0.04 * Math.cos(elapsedSeconds * 0.37),
    );
  const stressIndex =
    clamp01(
      config.stressBase +
        0.08 * Math.cos(elapsedSeconds * 0.21) -
        0.12 * Math.sin(elapsedSeconds * config.breathHz),
    );

  return {
    breathPhase: breathWave,
    pulsePhase: pulseWave,
    breathRate: normalizeRange(config.breathHz * 60, 5, 30),
    pulseRate: normalizeRange(config.pulseHz * 60, 40, 180),
    hrv,
    stressIndex,
    signalQuality: 1,
    source: "simulated",
  };
}

export function detectAudioBand(targetHz: number): AudioBandTrigger["id"] | null {
  const band = AUDIO_BAND_TRIGGERS.find(
    (candidate) => targetHz >= candidate.minHz && targetHz < candidate.maxHz,
  );
  return band?.id ?? null;
}

export function buildAudioContract(
  targetHz: number,
  hueMain: number,
  zoomVelocity: number,
): MandalaAudioContract {
  return {
    foundationLayerHz: 110 + (hueMain / 360) * 110,
    targetHz,
    textureBrightness: clamp01(0.35 + Math.abs(zoomVelocity) * 0.2),
    binauralDeltaHz: targetHz,
    gongTrigger: detectAudioBand(targetHz),
  };
}
