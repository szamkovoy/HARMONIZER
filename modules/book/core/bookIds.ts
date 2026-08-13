import type { AppLocale } from "@/modules/i18n";

/** Canonical product id (matches future API / progress rows). */
export const BOOK_ID = "yoga_wizards_path";

export type BookLocale = "ru" | "en" | "de" | "fr" | "it" | "es" | "pt" | "nl";

/** UI locale → book file. All 8 app locales have EPUBs when built. */
export function bookLocaleForAppLocale(locale: AppLocale): BookLocale {
  switch (locale) {
    case "en":
    case "de":
    case "fr":
    case "it":
    case "es":
    case "pt":
    case "nl":
      return locale;
    default:
      return "ru";
  }
}
