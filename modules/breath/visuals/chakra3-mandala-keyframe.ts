import { MANDALA_RECIPES } from "@/modules/mandala/core/recipes";
import type { MeditationPresetKeyframe, MeditationPresetScenario } from "@/modules/mandala/core/types";

function lotusBloomBase(): MeditationPresetKeyframe {
  const recipe = MANDALA_RECIPES.find((r) => r.id === "lotusBloom");
  if (!recipe) {
    throw new Error("lotusBloom recipe missing");
  }
  return recipe.build();
}

/** Солнечное сплетение: тёплый золотистый тон (см. chakra3 cloud в Bindu presets). */
export function buildChakra3CoherenceKeyframe(): MeditationPresetKeyframe {
  const base = lotusBloomBase();
  return {
    ...base,
    id: "breath-coherence-chakra3",
    appearance: {
      ...base.appearance,
      hueMain: 48,
      hueRange: 26,
      saturation: 0.44,
      luminanceBase: 0.46,
      ganzfeldMode: true,
    },
    artDirection: {
      ...base.artDirection,
      palettePreset: "midnightGold",
      glowStrength: 0.58,
      depthStrength: 0.22,
      ornamentDensity: 0.14,
    },
  };
}

export const CHAKRA3_COHERENCE_SCENARIO: MeditationPresetScenario = {
  id: "breath-coherence-chakra3",
  title: "Breath — Chakra 3",
  description: "Когерентное дыхание, мандала солнечного сплетения.",
  durationSeconds: 120,
  keyframes: [buildChakra3CoherenceKeyframe()],
};
