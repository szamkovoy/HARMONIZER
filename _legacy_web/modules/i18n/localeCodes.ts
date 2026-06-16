/** Shared locale codes for the 8-language product (RU authoring + 7 targets). */
export type AppContentLocale = "ru" | "en" | "de" | "fr" | "it" | "es" | "pt" | "nl";

export const SOURCE_LOCALE: AppContentLocale = "ru";

/** Locales filled by the JSON + typed sync gates (everything except RU). */
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

/** RU/EN inline tables in typed modules; other locales merge EN + overlay. */
export function inlineBaseLocale(locale: AppContentLocale): "ru" | "en" {
  return locale === SOURCE_LOCALE ? "ru" : "en";
}

/** BCP 47 tag for Intl formatters. */
export function intlLocaleTag(locale: AppContentLocale): string {
  const tags: Record<AppContentLocale, string> = {
    ru: "ru-RU",
    en: "en-US",
    de: "de-DE",
    fr: "fr-FR",
    it: "it-IT",
    es: "es-ES",
    pt: "pt-PT",
    nl: "nl-NL",
  };
  return tags[locale] ?? "en-US";
}
