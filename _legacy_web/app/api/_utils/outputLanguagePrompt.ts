import { languageNameFor, SOURCE_LOCALE, type AppContentLocale } from "./contentLocales";

/** Stored in scenario_cache payloads so pre-i18n rows regenerate in the correct language. */
export const MORNING_CACHE_OUTPUT_LOCALE_KEY = "outputLocale";

export function isMorningRecommendationCacheValid(
  cached: Record<string, unknown>,
  expectedModel: string | null,
  responseLocale: AppContentLocale,
): boolean {
  if (!cached.math_level) return false;
  if (cached[MORNING_CACHE_OUTPUT_LOCALE_KEY] !== responseLocale) return false;
  if (!expectedModel) return true;
  const used = typeof cached.modelUsed === "string" ? cached.modelUsed.trim() : "";
  return Boolean(used) && used === expectedModel;
}

/**
 * Prepended to monologue prompts whose template is authored in Russian.
 * Context (baselines, author voice) may stay RU; JSON output must match response locale.
 */
export function buildOutputLanguageBlock(locale: AppContentLocale): string {
  if (locale === SOURCE_LOCALE) {
    return [
      "═══════════════════════════════════════════════════════════════════",
      "ЯЗЫК ОТВЕТА: русский.",
      "Все пользовательские поля JSON (slogan, short_text, long_explanation) — только на русском.",
      "═══════════════════════════════════════════════════════════════════",
    ].join("\n");
  }

  const languageName = languageNameFor(locale);
  return [
    "═══════════════════════════════════════════════════════════════════",
    `OUTPUT LANGUAGE: ${languageName}.`,
    "The instructions below may be in Russian (source data). That is context only.",
    `You MUST write ALL JSON output fields (slogan, short_text, long_explanation) entirely in ${languageName}.`,
    "Do not output Russian (unless quoting a proper noun). Match the empathetic mentor tone.",
    "═══════════════════════════════════════════════════════════════════",
  ].join("\n");
}
