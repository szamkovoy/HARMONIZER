import { languageNameFor, SOURCE_LOCALE, type AppContentLocale } from "./contentLocales";

/** Stored in scenario_cache payloads so pre-i18n rows regenerate in the correct language. */
export const MORNING_CACHE_OUTPUT_LOCALE_KEY = "outputLocale";

/** Letters only — no Unicode property escapes (keeps Node + client heuristics aligned). */
const LETTER_RE = /[^A-Za-zА-Яа-яЁё]/g;
const CYRILLIC_RE = /[А-Яа-яЁё]/g;

/** Cyrillic-heavy copy under a non-RU cache key is treated as invalid. */
export function textLooksLikeRussian(text: string): boolean {
  const letters = text.replace(LETTER_RE, "");
  if (letters.length < 12) return false;
  const cyrillic = (letters.match(CYRILLIC_RE) ?? []).length;
  return cyrillic / letters.length >= 0.45;
}

export function morningTextsMatchLocale(
  locale: AppContentLocale,
  slogan: string,
  shortText: string,
): boolean {
  if (locale === SOURCE_LOCALE) return true;
  return !textLooksLikeRussian(slogan) && !textLooksLikeRussian(shortText);
}

/**
 * Usable morning cache for instant Home open.
 *
 * Intentionally does **not** require `modelUsed === expectedModel`: cron/Edge and
 * Vercel can temporarily disagree on `AI_MODEL_*` after a model cutover, and a
 * strict pin discarded a full warm row → paid users waited on LLM again.
 * Locale + math_level + non-empty locale-matching texts are enough to serve.
 * (`expectedModel` kept in the signature for call-site compatibility.)
 */
export function isMorningRecommendationCacheValid(
  cached: Record<string, unknown>,
  _expectedModel: string | null,
  responseLocale: AppContentLocale,
): boolean {
  if (!cached.math_level) return false;
  if (cached[MORNING_CACHE_OUTPUT_LOCALE_KEY] !== responseLocale) return false;
  const slogan = String(cached.slogan ?? "").trim();
  const shortText = String(cached.short_text ?? "").trim();
  if (!slogan || !shortText) return false;
  return morningTextsMatchLocale(responseLocale, slogan, shortText);
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

/** Extra nudge when the model ignored OUTPUT LANGUAGE on the first pass. */
export function buildOutputLanguageRetryBlock(locale: AppContentLocale): string {
  const languageName = languageNameFor(locale);
  return [
    "═══════════════════════════════════════════════════════════════════",
    `CRITICAL RETRY — OUTPUT LANGUAGE: ${languageName} ONLY.`,
    "Your previous JSON used the wrong language (often Russian).",
    `Rewrite slogan, short_text, and long_explanation entirely in ${languageName}.`,
    "Do not use Cyrillic letters at all unless the target language is Russian.",
    "═══════════════════════════════════════════════════════════════════",
  ].join("\n");
}
