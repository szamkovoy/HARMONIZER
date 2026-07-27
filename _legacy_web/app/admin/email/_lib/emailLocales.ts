export const TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
export type TargetLocale = (typeof TARGET_LOCALES)[number];
export type ContentLocale = "ru" | TargetLocale;

export const LOCALE_LABELS: Record<ContentLocale, string> = {
  ru: "RU",
  en: "EN",
  de: "DE",
  fr: "FR",
  it: "IT",
  es: "ES",
  pt: "PT",
  nl: "NL",
};

export const ALL_CONTENT_LOCALES = ["ru", ...TARGET_LOCALES] as ContentLocale[];
