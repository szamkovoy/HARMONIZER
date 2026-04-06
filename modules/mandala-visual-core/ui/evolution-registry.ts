import type { VisualRecipe } from "@/modules/mandala-visual-core/core/types";
import { DEFAULT_EVOLUTION_SHADER_BLOCK } from "@/modules/mandala-visual-core/ui/default-evolution-shader";
import { LOTUS_BLOOM_EVOLUTION_SHADER_BLOCK } from "@/modules/mandala-visual-core/ui/lotus-bloom-evolution-shader";

const EVOLUTION_SHADER_BLOCKS: Record<VisualRecipe, string> = {
  lotusBloom: LOTUS_BLOOM_EVOLUTION_SHADER_BLOCK,
  tunnelBloom: DEFAULT_EVOLUTION_SHADER_BLOCK,
  yantraPulse: DEFAULT_EVOLUTION_SHADER_BLOCK,
  fractalBloom: DEFAULT_EVOLUTION_SHADER_BLOCK,
  metatronPortal: DEFAULT_EVOLUTION_SHADER_BLOCK,
};

export function getEvolutionShaderBlock(recipe: VisualRecipe): string {
  return EVOLUTION_SHADER_BLOCKS[recipe] ?? DEFAULT_EVOLUTION_SHADER_BLOCK;
}
