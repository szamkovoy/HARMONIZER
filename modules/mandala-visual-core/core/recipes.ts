import { DEFAULT_ART_DIRECTION, DEFAULT_BIO_WEIGHTS, DEFAULT_KEYFRAME } from "@/modules/mandala-visual-core/core/defaults";
import type { MeditationPresetKeyframe, VisualRecipe } from "@/modules/mandala-visual-core/core/types";

export interface MandalaRecipeDefinition {
  id: VisualRecipe;
  title: string;
  description: string;
  build: () => MeditationPresetKeyframe;
}

function cloneDefaultKeyframe(id: string): MeditationPresetKeyframe {
  return {
    ...DEFAULT_KEYFRAME,
    id,
    geometry: { ...DEFAULT_KEYFRAME.geometry },
    primitives: { ...DEFAULT_KEYFRAME.primitives },
    complexity: { ...DEFAULT_KEYFRAME.complexity },
    imperfection: { ...DEFAULT_KEYFRAME.imperfection },
    appearance: { ...DEFAULT_KEYFRAME.appearance },
    modulation: { ...DEFAULT_KEYFRAME.modulation },
    kinetics: { ...DEFAULT_KEYFRAME.kinetics },
    bioWeights: { ...DEFAULT_BIO_WEIGHTS },
    artDirection: { ...DEFAULT_ART_DIRECTION },
  };
}

export const MANDALA_RECIPES: MandalaRecipeDefinition[] = [
  {
    id: "lotusBloom",
    title: "Lotus Bloom",
    description: "Мягкая многослойная розетка с дыханием и внутренним цветением.",
    build: () => {
      const base = cloneDefaultKeyframe("lotus-bloom");
      return {
        ...base,
        geometry: {
          ...base.geometry,
          topologyType: 1,
          beamCount: 6,
          aperture: 0.1,
          sacredPreset: 1,
          overlapFactor: 0.96,
        },
        primitives: {
          ...base.primitives,
          curvature: 0,
          vertices: 8,
          strokeWidth: 0.5,
          complexity: 0.18,
        },
        complexity: {
          fractalDimension: 1.14,
          recursionDepth: 0,
        },
        appearance: {
          hueMain: 232,
          hueRange: 34,
          saturation: 0.38,
          luminanceBase: 0.48,
          ganzfeldMode: true,
        },
        modulation: {
          targetHz: 8.6,
          waveform: 0,
          dutyCycle: 0.52,
        },
        kinetics: {
          zoomVelocity: 0.18,
          rotationVelocity: 0.18,
          motionLogic: 0,
          morphTarget: 4,
        },
        artDirection: {
          ...base.artDirection,
          visualRecipe: "lotusBloom",
          layerCount: 2,
          petalOpacity: 1,
          ornamentDensity: 0.12,
          depthStrength: 0.18,
          glowStrength: 0.54,
          revealMode: "pulseGate",
          palettePreset: "violetMist",
          petalProfile: "oval",
          evolutionProfile: "rebirth",
        },
      };
    },
  },
  {
    id: "tunnelBloom",
    title: "Tunnel Bloom",
    description: "Портальный туннель, в котором следующая мандала рождается из центра.",
    build: () => {
      const base = cloneDefaultKeyframe("tunnel-bloom");
      return {
        ...base,
        geometry: {
          ...base.geometry,
          topologyType: 0,
          ringDensity: 20,
          progressionMode: 2,
          beamCount: 12,
          sacredPreset: 3,
          lineMask: 3,
        },
        primitives: {
          ...base.primitives,
          curvature: 0.86,
          strokeWidth: 0.018,
          complexity: 0.58,
        },
        complexity: {
          fractalDimension: 1.28,
          recursionDepth: 3,
        },
        appearance: {
          hueMain: 214,
          hueRange: 28,
          saturation: 0.44,
          luminanceBase: 0.42,
          ganzfeldMode: true,
        },
        modulation: {
          targetHz: 7.2,
          waveform: 2,
          dutyCycle: 0.5,
        },
        kinetics: {
          zoomVelocity: 1.2,
          rotationVelocity: 0.46,
          motionLogic: 1,
          morphTarget: 1,
        },
        artDirection: {
          ...base.artDirection,
          visualRecipe: "tunnelBloom",
          layerCount: 4,
          petalOpacity: 0,
          ornamentDensity: 0.52,
          depthStrength: 0.86,
          glowStrength: 0.44,
          revealMode: "irisWave",
          palettePreset: "midnightGold",
          petalProfile: "lotusSpear",
          evolutionProfile: "haloCascade",
        },
      };
    },
  },
  {
    id: "yantraPulse",
    title: "Yantra Pulse",
    description: "Тонкая геометрия с пульсирующим центром и медленным раскрытием.",
    build: () => {
      const base = cloneDefaultKeyframe("yantra-pulse");
      return {
        ...base,
        geometry: {
          ...base.geometry,
          topologyType: 4,
          sacredPreset: 2,
          binduSize: 0.03,
          beamCount: 9,
          overlapFactor: 0.98,
        },
        primitives: {
          ...base.primitives,
          curvature: 0.18,
          vertices: 6,
          strokeWidth: 0.012,
          complexity: 0.64,
        },
        complexity: {
          fractalDimension: 1.18,
          recursionDepth: 2,
        },
        appearance: {
          hueMain: 284,
          hueRange: 22,
          saturation: 0.34,
          luminanceBase: 0.4,
          ganzfeldMode: false,
        },
        modulation: {
          targetHz: 6.3,
          waveform: 0,
          dutyCycle: 0.5,
        },
        kinetics: {
          zoomVelocity: 0.32,
          rotationVelocity: 0.18,
          motionLogic: 0,
          morphTarget: 1,
        },
        artDirection: {
          ...base.artDirection,
          visualRecipe: "yantraPulse",
          layerCount: 3,
          petalOpacity: 0,
          ornamentDensity: 0.48,
          depthStrength: 0.36,
          glowStrength: 0.5,
          revealMode: "pulseGate",
          palettePreset: "sunsetRose",
          petalProfile: "almond",
          evolutionProfile: "tidalBreath",
        },
      };
    },
  },
  {
    id: "fractalBloom",
    title: "Fractal Bloom",
    description: "Более органический и плотный фрактальный цветок.",
    build: () => {
      const base = cloneDefaultKeyframe("fractal-bloom");
      return {
        ...base,
        geometry: {
          ...base.geometry,
          topologyType: 2,
          twistFactor: 3.8,
          spiralOrder: 5,
          beamCount: 24,
        },
        primitives: {
          ...base.primitives,
          curvature: 0.92,
          vertices: 16,
          strokeWidth: 0.02,
          complexity: 0.82,
        },
        complexity: {
          fractalDimension: 1.5,
          recursionDepth: 5,
        },
        appearance: {
          hueMain: 148,
          hueRange: 44,
          saturation: 0.48,
          luminanceBase: 0.46,
          ganzfeldMode: true,
        },
        modulation: {
          targetHz: 5.4,
          waveform: 0,
          dutyCycle: 0.5,
        },
        kinetics: {
          zoomVelocity: 0.62,
          rotationVelocity: 0.62,
          motionLogic: 2,
          morphTarget: 3,
        },
        artDirection: {
          ...base.artDirection,
          visualRecipe: "fractalBloom",
          layerCount: 6,
          petalOpacity: 0,
          ornamentDensity: 0.88,
          depthStrength: 0.56,
          glowStrength: 0.62,
          revealMode: "centerBloom",
          palettePreset: "emeraldDream",
          petalProfile: "flame",
          evolutionProfile: "spiralDrift",
        },
      };
    },
  },
  {
    id: "metatronPortal",
    title: "Metatron Portal",
    description: "Священный портал с кубической структурой и центральным рождением новой формы.",
    build: () => {
      const base = cloneDefaultKeyframe("metatron-portal");
      return {
        ...base,
        geometry: {
          ...base.geometry,
          topologyType: 4,
          sacredPreset: 3,
          overlapFactor: 1.04,
          lineMask: 15,
          beamCount: 12,
        },
        primitives: {
          ...base.primitives,
          curvature: 0.74,
          vertices: 12,
          strokeWidth: 0.015,
          complexity: 0.7,
        },
        complexity: {
          fractalDimension: 1.36,
          recursionDepth: 4,
        },
        appearance: {
          hueMain: 221,
          hueRange: 18,
          saturation: 0.28,
          luminanceBase: 0.38,
          ganzfeldMode: true,
        },
        modulation: {
          targetHz: 8.2,
          waveform: 1,
          dutyCycle: 0.42,
        },
        kinetics: {
          zoomVelocity: 0.94,
          rotationVelocity: 0.34,
          motionLogic: 1,
          morphTarget: 0,
        },
        artDirection: {
          ...base.artDirection,
          visualRecipe: "metatronPortal",
          layerCount: 5,
          petalOpacity: 0,
          ornamentDensity: 0.64,
          depthStrength: 0.78,
          glowStrength: 0.46,
          revealMode: "irisWave",
          palettePreset: "midnightGold",
          petalProfile: "splitPetal",
          evolutionProfile: "haloCascade",
        },
      };
    },
  },
];

export function getRecipeById(id: VisualRecipe): MandalaRecipeDefinition {
  const recipe = MANDALA_RECIPES.find((candidate) => candidate.id === id);
  return recipe ?? MANDALA_RECIPES[0];
}
