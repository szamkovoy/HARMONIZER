import {
  ALL_CONTENT_LOCALES,
  asContentLocale,
  SOURCE_LOCALE,
  type AppContentLocale,
} from "@/modules/i18n/localeCodes";

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Soft resolve for push/inbox copy:
 * preferred → en (when L ≠ ru) → ru → first non-empty in ALL_CONTENT_LOCALES.
 * Do **not** use for Videos/Webinars feed visibility — those need exact locale.
 */
export function pickLocalizedText(
  locale: AppContentLocale,
  ruText: string | null | undefined,
  translations?: Record<string, string | undefined> | null,
): string {
  const ru = trimmed(ruText);
  const map = translations ?? {};

  if (locale === SOURCE_LOCALE) {
    if (ru) return ru;
  } else {
    const preferred = trimmed(map[locale]);
    if (preferred) return preferred;
    const en = trimmed(map.en);
    if (en) return en;
    if (ru) return ru;
  }

  for (const code of ALL_CONTENT_LOCALES) {
    if (code === SOURCE_LOCALE) {
      if (ru) return ru;
      continue;
    }
    const value = trimmed(map[code]);
    if (value) return value;
  }
  return ru;
}

/**
 * Strict authored text for locale `L` only (RU column / `*_i18n[L]`).
 * Used by Videos feed, post detail, webinar announce UI.
 */
export function pickExactLocalizedText(
  locale: AppContentLocale,
  ruText: string | null | undefined,
  translations?: Record<string, string | undefined> | null,
): string {
  if (locale === SOURCE_LOCALE) return trimmed(ruText);
  return trimmed(translations?.[locale]);
}

/** Same as pickLocalizedText but returns null when nothing is available. */
export function pickLocalizedTextOrNull(
  locale: AppContentLocale,
  ruText: string | null | undefined,
  translations?: Record<string, string | undefined> | null,
): string | null {
  const value = pickLocalizedText(locale, ruText, translations);
  return value ? value : null;
}

export function pickExactLocalizedTextOrNull(
  locale: AppContentLocale,
  ruText: string | null | undefined,
  translations?: Record<string, string | undefined> | null,
): string | null {
  const value = pickExactLocalizedText(locale, ruText, translations);
  return value ? value : null;
}

/** Soft URL resolve: preferred → en → ru (notifications / soft surfaces). */
export function pickLocalizedUrl(
  locale: AppContentLocale,
  ruUrl: string | null | undefined,
  urlByLocale?: Record<string, string | undefined> | null,
): string | null {
  const value = pickLocalizedTextOrNull(locale, ruUrl, urlByLocale);
  return value || null;
}

/** Exact URL for locale `L` only. */
export function pickExactLocalizedUrl(
  locale: AppContentLocale,
  ruUrl: string | null | undefined,
  urlByLocale?: Record<string, string | undefined> | null,
): string | null {
  return pickExactLocalizedTextOrNull(locale, ruUrl, urlByLocale);
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

/** Soft title presence (preferred → en → ru). */
export function hasLocalizedTitle(
  locale: AppContentLocale,
  ruTitle: string | null | undefined,
  titleI18n?: Record<string, string | undefined> | null,
): boolean {
  return Boolean(pickLocalizedTextOrNull(locale, ruTitle, titleI18n));
}

/** True only when locale `L` has an authored title. */
export function hasExactLocalizedTitle(
  locale: AppContentLocale,
  ruTitle: string | null | undefined,
  titleI18n?: Record<string, string | undefined> | null,
): boolean {
  return Boolean(pickExactLocalizedTextOrNull(locale, ruTitle, titleI18n));
}
