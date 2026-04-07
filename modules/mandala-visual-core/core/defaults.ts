import type {
  MandalaArtDirectionState,
  BioSimConfig,
  BioWeightMap,
  MandalaSessionState,
  MeditationPresetKeyframe,
  MeditationPresetScenario,
} from "@/modules/mandala-visual-core/core/types";

export const DEFAULT_BIO_WEIGHTS: BioWeightMap = {
  breathToScale: 0.18,
  pulseToGlow: 0.08,
  hrvToComplexity: 0.24,
  stressToEntropy: 0.32,
};

export const DEFAULT_BIO_SIM_CONFIG: BioSimConfig = {
  enabled: true,
  breathHz: 0.33,
  pulseHz: 1.1,
  hrvBase: 0.56,
  stressBase: 0.32,
};

export const DEFAULT_ART_DIRECTION: MandalaArtDirectionState = {
  visualRecipe: "lotusBloom",
  layerCount: 4,
  petalOpacity: 0,
  ornamentDensity: 0.62,
  depthStrength: 0.58,
  glowStrength: 0.54,
  revealMode: "centerBloom",
  palettePreset: "violetMist",
  petalProfile: "teardrop",
  evolutionProfile: "rebirth",
};

export const DEFAULT_KEYFRAME: MeditationPresetKeyframe = {
  id: "alpha-tunnel",
  timestamp: 0,
  duration: 60,
  geometry: {
    topologyType: 0,
    ringDensity: 12,
    progressionMode: 2,
    beamCount: 12,
    aperture: 0.42,
    twistFactor: 1.8,
    spiralOrder: 3,
    gridType: 6,
    sacredPreset: 1,
    overlapFactor: 1,
    lineMask: 7,
    binduSize: 0.02,
  },
  primitives: {
    curvature: 0.88,
    vertices: 12,
    strokeWidth: 0.018,
    complexity: 0.56,
  },
  complexity: {
    fractalDimension: 1.32,
    recursionDepth: 3,
  },
  imperfection: {
    symmetryDeviation: 0.12,
  },
  appearance: {
    hueMain: 220,
    hueRange: 30,
    saturation: 0.42,
    luminanceBase: 0.44,
    ganzfeldMode: true,
  },
  modulation: {
    targetHz: 10,
    waveform: 0,
    dutyCycle: 0.5,
  },
  kinetics: {
    zoomVelocity: 0.35,
    rotationVelocity: 0.4,
    motionLogic: 1,
    morphTarget: 2,
  },
  bioWeights: DEFAULT_BIO_WEIGHTS,
  artDirection: DEFAULT_ART_DIRECTION,
};

export const DEFAULT_SCENARIO: MeditationPresetScenario = {
  id: "sandbox-default",
  title: "Sandbox Alpha Flow",
  description: "Базовый пресет для отладки MandalaVisualCore и BioSim.",
  durationSeconds: 600,
  keyframes: [DEFAULT_KEYFRAME],
};

export function createSessionStateFromKeyframe(
  scenario: MeditationPresetScenario,
  keyframe: MeditationPresetKeyframe = scenario.keyframes[0],
): MandalaSessionState {
  return {
    scenarioId: scenario.id,
    activeKeyframeId: keyframe.id,
    geometry: { ...keyframe.geometry },
    primitives: { ...keyframe.primitives },
    complexity: { ...keyframe.complexity },
    imperfection: { ...keyframe.imperfection },
    appearance: { ...keyframe.appearance },
    modulation: { ...keyframe.modulation },
    kinetics: { ...keyframe.kinetics },
    bioWeights: { ...keyframe.bioWeights },
    artDirection: { ...keyframe.artDirection },
  };
}
