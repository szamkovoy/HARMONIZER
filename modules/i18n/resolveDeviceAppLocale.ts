/**
 * First-launch device → app locale (no SecureStore / profile yet).
 * Free of React Native so vitest can import it in Node.
 */

/** Same 8 codes as `AppLocale` in `localeStore` (kept in sync manually). */
const ENABLED_APP_LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;
type EnabledAppLocale = (typeof ENABLED_APP_LOCALES)[number];

/** ISO 639-1 codes that map to Russian when none of the 8 app locales match. */
export const DEVICE_LOCALE_RU_CLUSTER = ["be", "uk", "kk", "ky", "uz", "tg"] as const;

const DEVICE_LOCALE_FALLBACK: EnabledAppLocale = "en";
const DEFAULT_APP_LOCALE: EnabledAppLocale = "ru";

function isEnabledLocale(value: string): value is EnabledAppLocale {
  return (ENABLED_APP_LOCALES as readonly string[]).includes(value);
}

/**
 * Pure resolver. `languageCodes` = ordered ISO 639-1 list (primary first).
 *
 * 1) first enabled app locale among preferences;
 * 2) else RU-cluster (be/uk/kk/ky/uz/tg) → ru;
 * 3) else en.
 */
export function resolveDeviceAppLocale(languageCodes: readonly string[]): EnabledAppLocale {
  for (const raw of languageCodes) {
    const code = raw.trim().slice(0, 2).toLowerCase();
    if (isEnabledLocale(code)) return code;
  }
  for (const raw of languageCodes) {
    const code = raw.trim().slice(0, 2).toLowerCase();
    if ((DEVICE_LOCALE_RU_CLUSTER as readonly string[]).includes(code)) {
      return isEnabledLocale("ru") ? "ru" : DEFAULT_APP_LOCALE;
    }
  }
  return isEnabledLocale(DEVICE_LOCALE_FALLBACK) ? DEVICE_LOCALE_FALLBACK : DEFAULT_APP_LOCALE;
}
