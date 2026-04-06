import type {
  BioWeightMap,
  MandalaArtDirectionState,
  MandalaSessionState,
  MeditationPresetKeyframe,
  MeditationPresetScenario,
} from "@/modules/mandala-visual-core/core/types";

const PETAL_PROFILES = [
  "teardrop",
  "almond",
  "lotusSpear",
  "roundedSpoon",
  "flame",
  "heartPetal",
  "splitPetal",
  "oval",
] as const;

const EVOLUTION_PROFILES = [
  "rebirth",
  "spiralDrift",
  "tidalBreath",
  "haloCascade",
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

export function sanitizeBioWeights(weights: BioWeightMap): BioWeightMap {
  return {
    breathToScale: clamp(weights.breathToScale, 0, 1),
    pulseToGlow: clamp(weights.pulseToGlow, 0, 1),
    hrvToComplexity: clamp(weights.hrvToComplexity, 0, 1),
    stressToEntropy: clamp(weights.stressToEntropy, 0, 1),
  };
}

export function sanitizeArtDirection(
  artDirection: MandalaArtDirectionState,
): MandalaArtDirectionState {
  return {
    ...artDirection,
    layerCount: clampInt(artDirection.layerCount, 1, 6),
    ornamentDensity: clamp(artDirection.ornamentDensity, 0, 1),
    depthStrength: clamp(artDirection.depthStrength, 0, 1),
    glowStrength: clamp(artDirection.glowStrength, 0, 1),
    petalProfile: PETAL_PROFILES.includes(artDirection.petalProfile)
      ? artDirection.petalProfile
      : "teardrop",
    evolutionProfile: EVOLUTION_PROFILES.includes(artDirection.evolutionProfile)
      ? artDirection.evolutionProfile
      : "rebirth",
  };
}

export function sanitizeKeyframe(
  keyframe: MeditationPresetKeyframe,
): MeditationPresetKeyframe {
  return {
    ...keyframe,
    timestamp: Math.max(0, keyframe.timestamp),
    duration: Math.max(0.25, keyframe.duration),
    geometry: {
      ...keyframe.geometry,
      ringDensity: clamp(keyframe.geometry.ringDensity, 1, 50),
      beamCount: clampInt(keyframe.geometry.beamCount, 3, 64),
      aperture: clamp(keyframe.geometry.aperture, 0.1, 1),
      twistFactor: clamp(keyframe.geometry.twistFactor, -10, 10),
      spiralOrder: clampInt(keyframe.geometry.spiralOrder, 1, 12),
      overlapFactor: clamp(keyframe.geometry.overlapFactor, 0.7, 1.4),
      lineMask: clampInt(keyframe.geometry.lineMask, 0, 31),
      binduSize: clamp(keyframe.geometry.binduSize, 0.005, 0.08),
    },
    primitives: {
      curvature: clamp(keyframe.primitives.curvature, 0, 1),
      vertices: clampInt(keyframe.primitives.vertices, 3, 20),
      strokeWidth: clamp(keyframe.primitives.strokeWidth, 0.001, 0.1),
      complexity: clamp(keyframe.primitives.complexity, 0, 1),
    },
    complexity: {
      fractalDimension: clamp(keyframe.complexity.fractalDimension, 1.05, 1.6),
      recursionDepth: clampInt(keyframe.complexity.recursionDepth, 0, 5),
    },
    imperfection: {
      symmetryDeviation: clamp(keyframe.imperfection.symmetryDeviation, 0, 1),
    },
    appearance: {
      hueMain: clamp(keyframe.appearance.hueMain, 0, 360),
      hueRange: clamp(keyframe.appearance.hueRange, 0, 120),
      saturation: clamp(keyframe.appearance.saturation, 0, 1),
      luminanceBase: clamp(keyframe.appearance.luminanceBase, 0, 1),
      ganzfeldMode: keyframe.appearance.ganzfeldMode,
    },
    modulation: {
      targetHz: clamp(keyframe.modulation.targetHz, 0.5, 15),
      waveform: keyframe.modulation.waveform,
      dutyCycle: clamp(keyframe.modulation.dutyCycle, 0.1, 0.9),
    },
    kinetics: {
      zoomVelocity: clamp(keyframe.kinetics.zoomVelocity, -2, 2),
      rotationVelocity: clamp(keyframe.kinetics.rotationVelocity, -5, 5),
      motionLogic: keyframe.kinetics.motionLogic,
      morphTarget: keyframe.kinetics.morphTarget,
    },
    bioWeights: sanitizeBioWeights(keyframe.bioWeights),
    artDirection: sanitizeArtDirection(keyframe.artDirection),
  };
}

export function sanitizeScenario(
  scenario: MeditationPresetScenario,
): MeditationPresetScenario {
  return {
    ...scenario,
    durationSeconds: Math.max(1, scenario.durationSeconds),
    keyframes: scenario.keyframes.map(sanitizeKeyframe),
  };
}

export function sessionStateToKeyframe(
  state: MandalaSessionState,
): MeditationPresetKeyframe {
  return {
    id: state.activeKeyframeId,
    timestamp: 0,
    duration: 60,
    geometry: { ...state.geometry },
    primitives: { ...state.primitives },
    complexity: { ...state.complexity },
    imperfection: { ...state.imperfection },
    appearance: { ...state.appearance },
    modulation: { ...state.modulation },
    kinetics: { ...state.kinetics },
    bioWeights: { ...state.bioWeights },
    artDirection: { ...state.artDirection },
  };
}
