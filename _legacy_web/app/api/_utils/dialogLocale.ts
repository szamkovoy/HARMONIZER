/**
 * Dialog response-locale resolution (i18n foundation).
 *
 * The language the assistant RESPONDS in is deliberately separate from the
 * language the user INPUTS (speaks/types). This lets us run a test mode where
 * the user speaks Russian but the assistant answers in another language driven
 * by app settings, while in production we can auto-detect the input language.
 *
 * Priority of the response locale:
 *   1. `DIALOG_RESPONSE_LOCALE` env override (headless/server test mode) — forces
 *      the answer language regardless of any other signal.
 *   2. The locale requested by the client in the POST body (`responseLocale`,
 *      from the in-app language selector).
 *   3. The user's stored `users.locale` (production default).
 *   4. `ru` fallback.
 *
 * IMPORTANT: today only `ru` and `en` are FULLY supported as response locales,
 * because the deterministic visible-text builders (planning/summary finals,
 * clarifying questions, date labels) are ru/en only. Adding de/fr/it/es/pt/nl
 * as response locales requires localizing those builders (or making them
 * LLM-driven) — see docs/04_workspace/i18n_architecture.md.
 */
export type ResponseLocale = "ru" | "en";

/** Response locales whose deterministic scaffolding is fully implemented. */
const SUPPORTED_RESPONSE_LOCALES: readonly ResponseLocale[] = ["ru", "en"] as const;

/** Human-readable language names by ISO-639-1 prefix (used in prompts as `languageName`). */
const LANGUAGE_NAMES: Record<string, string> = {
  ru: "Russian",
  en: "English",
  de: "German",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
  nl: "Dutch",
};

function localePrefix(locale: string | null | undefined): string {
  return (locale ?? "").trim().slice(0, 2).toLowerCase();
}

/** Map a locale (e.g. "en", "en-US", "it") to the English name of the language. */
export function localeToLanguageName(locale: string | null | undefined): string {
  return LANGUAGE_NAMES[localePrefix(locale)] ?? "Russian";
}

function asSupported(locale: string | null | undefined): ResponseLocale | null {
  const prefix = localePrefix(locale);
  return (SUPPORTED_RESPONSE_LOCALES as readonly string[]).includes(prefix)
    ? (prefix as ResponseLocale)
    : null;
}

/**
 * Resolve the locale the assistant should respond in.
 * Returns a binary ru/en today (see file header). Precedence:
 *   env override → client-requested locale → user's stored locale → ru.
 * Unsupported values at any level are skipped (fall through to the next signal).
 */
export function resolveResponseLocale(
  userLocale: string | null | undefined,
  requestedLocale?: string | null,
): ResponseLocale {
  return (
    asSupported(process.env.DIALOG_RESPONSE_LOCALE)
    ?? asSupported(requestedLocale)
    ?? asSupported(userLocale)
    ?? "ru"
  );
}
