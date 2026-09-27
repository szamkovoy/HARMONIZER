import { isGlobalMathLevelCurrent } from "./globalMathSchema";
import { isCurrentGlobalLongExplanation } from "./recommendationText";

function hasRequiredText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Same predicate as the warm/serve path. Lives here so an idle hourly warm
 * can decide "already fresh" without importing Gemini or astronomia.
 */
export function globalContentNeedsRefresh(
  existing: Record<string, unknown> | null | undefined,
  expectedModel: string,
): boolean {
  if (!existing) return true;
  const existingModel = typeof existing.llm_model === "string" ? existing.llm_model.trim() : "";
  if (!existingModel || existingModel !== expectedModel) return true;
  if (!hasRequiredText(existing.slogan)) return true;
  if (!hasRequiredText(existing.short_text)) return true;
  if (!hasRequiredText(existing.long_explanation)) return true;
  const longExplanation = typeof existing.long_explanation === "string" ? existing.long_explanation : undefined;
  if (!isCurrentGlobalLongExplanation(longExplanation)) return true;
  if (!isGlobalMathLevelCurrent(existing.math_level)) return true;
  return false;
}

/**
 * Model id for the idle check. Returns null when the hint needs Gemini's
 * alias table — caller must then take the full warm path instead of skipping.
 */
export function expectedModelFromHint(hint: string | null | undefined): string | null {
  const raw = hint?.trim() ?? "";
  const tier = raw.toLowerCase();
  if (!raw) return null;
  if (tier === "standard") return process.env.AI_MODEL_STANDARD?.trim() || null;
  if (tier === "premium") return process.env.AI_MODEL_PREMIUM?.trim() || null;
  if (tier.startsWith("gemini-") || tier.startsWith("deepseek-")) return raw;
  return null;
}
