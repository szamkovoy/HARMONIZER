export type TopologyType = 0 | 1 | 2 | 3 | 4;
export type ProgressionMode = 0 | 1 | 2;
export type GridType = 0 | 3 | 4 | 6;
export type SacredPreset = 1 | 2 | 3;
export type Waveform = 0 | 1 | 2;
export type MotionLogic = 0 | 1 | 2;
export type BioSignalSource = "simulated" | "sensor" | "mixed" | "offline";
export type VisualRecipe =
  | "lotusBloom"
  | "tunnelBloom"
  | "yantraPulse"
  | "fractalBloom"
  | "metatronPortal";
export type RevealMode = "centerBloom" | "irisWave" | "pulseGate";
export type PalettePreset =
  | "midnightGold"
  | "violetMist"
  | "emeraldDream"
  | "sunsetRose";
export type PetalProfile =
  | "teardrop"
  | "almond"
  | "lotusSpear"
  | "roundedSpoon"
  | "flame"
  | "heartPetal"
  | "splitPetal"
  | "oval";
export type EvolutionProfile =
  | "rebirth"
  | "spiralDrift"
  | "tidalBreath"
  | "haloCascade";

export interface MandalaGeometryState {
  topologyType: TopologyType;
  ringDensity: number;
  progressionMode: ProgressionMode;
  beamCount: number;
  aperture: number;
  twistFactor: number;
  spiralOrder: number;
  gridType: GridType;
  sacredPreset: SacredPreset;
  overlapFactor: number;
  lineMask: number;
  binduSize: number;
}

export interface MandalaPrimitiveState {
  curvature: number;
  vertices: number;
  strokeWidth: number;
  complexity: number;
}

export interface MandalaComplexityState {
  fractalDimension: number;
  recursionDepth: number;
}

export interface MandalaImperfectionState {
  symmetryDeviation: number;
}

export interface MandalaAppearanceState {
  hueMain: number;
  hueRange: number;
  saturation: number;
  luminanceBase: number;
  ganzfeldMode: boolean;
}

export interface MandalaModulationState {
  targetHz: number;
  waveform: Waveform;
  dutyCycle: number;
}

export interface MandalaKineticsState {
  zoomVelocity: number;
  rotationVelocity: number;
  motionLogic: MotionLogic;
  morphTarget: TopologyType;
}

export interface BioWeightMap {
  breathToScale: number;
  pulseToGlow: number;
  hrvToComplexity: number;
  stressToEntropy: number;
}

export interface MandalaArtDirectionState {
  visualRecipe: VisualRecipe;
  layerCount: number;
  petalOpacity: number;
  ornamentDensity: number;
  depthStrength: number;
  glowStrength: number;
  revealMode: RevealMode;
  palettePreset: PalettePreset;
  petalProfile: PetalProfile;
  evolutionProfile: EvolutionProfile;
}

export interface BioSignalFrame {
  breathPhase: number;
  pulsePhase: number;
  breathRate: number;
  pulseRate: number;
  hrv: number;
  stressIndex: number;
  signalQuality: number;
  source: BioSignalSource;
}

export interface MeditationPresetKeyframe {
  id: string;
  timestamp: number;
  duration: number;
  geometry: MandalaGeometryState;
  primitives: MandalaPrimitiveState;
  complexity: MandalaComplexityState;
  imperfection: MandalaImperfectionState;
  appearance: MandalaAppearanceState;
  modulation: MandalaModulationState;
  kinetics: MandalaKineticsState;
  bioWeights: BioWeightMap;
  artDirection: MandalaArtDirectionState;
}

export interface MeditationPresetScenario {
  id: string;
  title: string;
  description: string;
  durationSeconds: number;
  keyframes: MeditationPresetKeyframe[];
}

export interface MandalaSessionState {
  scenarioId: string;
  activeKeyframeId: string;
  geometry: MandalaGeometryState;
  primitives: MandalaPrimitiveState;
  complexity: MandalaComplexityState;
  imperfection: MandalaImperfectionState;
  appearance: MandalaAppearanceState;
  modulation: MandalaModulationState;
  kinetics: MandalaKineticsState;
  bioWeights: BioWeightMap;
  artDirection: MandalaArtDirectionState;
}

export interface BioSimConfig {
  enabled: boolean;
  breathHz: number;
  pulseHz: number;
  hrvBase: number;
  stressBase: number;
}

export interface AudioBandTrigger {
  id: "alpha" | "theta" | "delta";
  minHz: number;
  maxHz: number;
  gongVariant: "small" | "medium" | "large";
}

export interface MandalaAudioContract {
  foundationLayerHz: number;
  targetHz: number;
  textureBrightness: number;
  binauralDeltaHz: number;
  gongTrigger: AudioBandTrigger["id"] | null;
}
