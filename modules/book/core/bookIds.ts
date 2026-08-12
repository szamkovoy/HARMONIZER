import type { AppLocale } from "@/modules/i18n";

/** Canonical product id (matches future API / progress rows). */
export const BOOK_ID = "yoga_wizards_path";

export type BookLocale = "ru" | "en";

/** Phase A: only RU asset is built. Others fall back until Phase C. */
export function bookLocaleForAppLocale(locale: AppLocale): BookLocale {
  if (locale === "en") return "en";
  return "ru";
}
