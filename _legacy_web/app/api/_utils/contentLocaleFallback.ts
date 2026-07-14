/**
 * Server-side mirror of modules/i18n/pickLocalizedContent.ts — keep in sync.
 * Soft fallback (preferred → en → ru) for notifications push/inbox only.
 * Videos/webinars use client `pickExactLocalizedText` + exact SQL feed filter.
 */
import { ALL_CONTENT_LOCALES, SOURCE_LOCALE, type AppContentLocale } from "./contentLocales";

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

export function parseStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const text = trimmed(value);
    if (text) out[key] = text;
  }
  return out;
}
