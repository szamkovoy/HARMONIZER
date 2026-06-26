const LEGACY_MODEL_UPGRADES: Record<string, string> = {
  "gemini-1.5-flash": "gemini-2.5-flash",
  "gemini-1.5-pro": "gemini-2.5-flash",
};

/** Informal names → ids on generativelanguage.googleapis.com v1beta (Gemini 3 docs). */
const INFORMAL_GEMINI_MODEL_IDS: Record<string, string> = {
  "gemini-3.1-flash": "gemini-3-flash-preview",
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
};

/** Resolves prompts.model_hint tier to a concrete Gemini model id from Edge secrets. */
export function resolveGeminiModelIdFromTierEnv(hint: string | null | undefined): string {
  const tier = hint?.trim().toLowerCase() ?? "";
  const model =
    tier === "premium" ? Deno.env.get("AI_MODEL_PREMIUM")?.trim() : Deno.env.get("AI_MODEL_STANDARD")?.trim();
  if (!model) {
    throw new Error(tier === "premium" ? "Missing AI_MODEL_PREMIUM" : "Missing AI_MODEL_STANDARD");
  }
  const lower = model.toLowerCase();
  if (Deno.env.get("ALLOW_LEGACY_GEMINI_MODELS") === "true") {
    const upgraded = LEGACY_MODEL_UPGRADES[lower];
    if (upgraded) return upgraded;
  }
  return INFORMAL_GEMINI_MODEL_IDS[lower] ?? model;
}

export function resolveFallbackGeminiModelIdFromEnv(): string {
  const model = Deno.env.get("AI_MODEL_FALLBACK")?.trim();
  if (!model) {
    throw new Error("Missing AI_MODEL_FALLBACK");
  }
  const lower = model.toLowerCase();
  if (Deno.env.get("ALLOW_LEGACY_GEMINI_MODELS") === "true") {
    const upgraded = LEGACY_MODEL_UPGRADES[lower];
    if (upgraded) return upgraded;
  }
  return INFORMAL_GEMINI_MODEL_IDS[lower] ?? model;
}
