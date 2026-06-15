/**
 * Server-side locale codes — keep in sync with modules/i18n/localeCodes.ts.
 */
export type AppContentLocale = "ru" | "en" | "de" | "fr" | "it" | "es" | "pt" | "nl";

export const SOURCE_LOCALE: AppContentLocale = "ru";

export const TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;

export type TargetLocale = (typeof TARGET_LOCALES)[number];

export const ALL_CONTENT_LOCALES: readonly AppContentLocale[] = [
  SOURCE_LOCALE,
  ...TARGET_LOCALES,
] as const;

export const LANGUAGE_NAMES: Record<AppContentLocale, string> = {
  ru: "Russian",
  en: "English",
  de: "German",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
  nl: "Dutch",
};

export function localePrefix(value: string | null | undefined): string {
  return (value ?? "").trim().slice(0, 2).toLowerCase();
}

export function asContentLocale(value: string | null | undefined): AppContentLocale | null {
  const prefix = localePrefix(value);
  return (ALL_CONTENT_LOCALES as readonly string[]).includes(prefix) ? (prefix as AppContentLocale) : null;
}

export function languageNameFor(locale: string | null | undefined): string {
  return LANGUAGE_NAMES[asContentLocale(locale) ?? SOURCE_LOCALE];
}

/** Layer C (dialog deterministic builders) — localized for all content locales. */
export type DialogScaffoldLocale = AppContentLocale;

export function asDialogScaffoldLocale(value: string | null | undefined): DialogScaffoldLocale | null {
  return asContentLocale(value);
}

/**
 * Locale for LLM-generated content (recommendations, global texts, monologue).
 * Precedence: env override → request body → users.locale → ru.
 */
export function resolveContentLocale(
  userLocale: string | null | undefined,
  requestedLocale?: string | null,
): AppContentLocale {
  return (
    asContentLocale(process.env.DIALOG_RESPONSE_LOCALE)
    ?? asContentLocale(requestedLocale)
    ?? asContentLocale(userLocale)
    ?? SOURCE_LOCALE
  );
}

/**
 * Locale for dialog deterministic scaffolding (planning/summary finals, date labels).
 * Same precedence as layer B; all eight locales have scaffold catalogs.
 */
export function resolveDialogScaffoldLocale(
  userLocale: string | null | undefined,
  requestedLocale?: string | null,
): DialogScaffoldLocale {
  return resolveContentLocale(userLocale, requestedLocale);
}

/** @deprecated alias — use resolveContentLocale for layer B, resolveDialogScaffoldLocale for layer C */
export type ResponseLocale = AppContentLocale;

export function resolveResponseLocale(
  userLocale: string | null | undefined,
  requestedLocale?: string | null,
): AppContentLocale {
  return resolveContentLocale(userLocale, requestedLocale);
}

export function localeToLanguageName(locale: string | null | undefined): string {
  return languageNameFor(locale);
}
