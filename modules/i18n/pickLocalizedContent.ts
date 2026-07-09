import { asContentLocale, SOURCE_LOCALE, type AppContentLocale } from "@/modules/i18n/localeCodes";

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Pick user-authored text: RU source column, else translation for active locale, else RU fallback. */
export function pickLocalizedText(
  locale: AppContentLocale,
  ruText: string | null | undefined,
  translations?: Record<string, string | undefined> | null,
): string {
  const ru = trimmed(ruText);
  if (locale === SOURCE_LOCALE) return ru;
  const translated = trimmed(translations?.[locale]);
  return translated || ru;
}

/** Same as pickLocalizedText but returns null when both source and translation are empty. */
export function pickLocalizedTextOrNull(
  locale: AppContentLocale,
  ruText: string | null | undefined,
  translations?: Record<string, string | undefined> | null,
): string | null {
  const value = pickLocalizedText(locale, ruText, translations);
  return value ? value : null;
}

/** Per-locale URL map (e.g. post cover): locale-specific value, else RU source URL. */
export function pickLocalizedUrl(
  locale: AppContentLocale,
  ruUrl: string | null | undefined,
  urlByLocale?: Record<string, string | undefined> | null,
): string | null {
  const ru = trimmed(ruUrl);
  if (locale === SOURCE_LOCALE) return ru || null;
  const localized = trimmed(urlByLocale?.[locale]);
  return localized || ru || null;
}

export function parseStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!asContentLocale(key)) continue;
    const text = trimmed(value);
    if (text) out[key] = text;
  }
  return out;
}
