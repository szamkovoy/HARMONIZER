/**
 * Server-side mirror of modules/i18n/pickLocalizedContent.ts — keep in sync.
 * Soft fallback (preferred → en → ru) for inbox display of already-delivered copy.
 * Admin remote push uses exact locale match (see notificationCopy.ts).
 * Videos/webinars use client `pickExactLocalizedText` + exact SQL feed filter.
 */
import {
  ALL_CONTENT_LOCALES,
  asContentLocale,
  SOURCE_LOCALE,
  type AppContentLocale,
} from "./contentLocales";

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** preferred → en (when L ≠ ru) → ru → first non-empty in ALL_CONTENT_LOCALES. */
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

/** Strict authored text for locale `L` only (RU column / `*_i18n[L]`). */
export function pickExactLocalizedText(
  locale: AppContentLocale,
  ruText: string | null | undefined,
  translations?: Record<string, string | undefined> | null,
): string {
  if (locale === SOURCE_LOCALE) return trimmed(ruText);
  return trimmed(translations?.[locale]);
}

export function hasExactLocalizedTitle(
  locale: AppContentLocale,
  ruTitle: string | null | undefined,
  titleI18n?: Record<string, string | undefined> | null,
): boolean {
  return Boolean(pickExactLocalizedText(locale, ruTitle, titleI18n));
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
