import type { AppLocale } from "@/modules/i18n/localeStore";

/**
 * Localized app **display** name per locale — the brand name as it appears in
 * the OS (home-screen label, lock-screen media card, system permission prompts).
 *
 * This is the runtime mirror of the build-time `APP_NAMES` map in
 * `plugins/appLocalesData.js` (consumed by the `expo.locales` plugin →
 * `CFBundleDisplayName` / Android `values-<lang>/strings.xml` `app_name`).
 * Keep the two maps in sync; the i18n spec §6 (adding a language) is the
 * checkpoint where both get a new entry.
 *
 * Note: this is distinct from the in-app Latin brand label `appTitle`
 * ("Harmonizer" in all locales) — that one stays Latin everywhere.
 */
export const APP_DISPLAY_NAMES: Record<AppLocale, string> = {
  ru: "Гармонизатор",
  en: "Harmonizer",
  de: "Harmonisierer",
  fr: "Harmoniseur",
  it: "Armonizzatore",
  es: "Armonizador",
  pt: "Harmonizador",
  nl: "Harmoniseerder",
};

/** Localized display name for the active profile locale (falls back to EN). */
export function getAppDisplayName(locale: AppLocale): string {
  return APP_DISPLAY_NAMES[locale] ?? APP_DISPLAY_NAMES.en;
}
