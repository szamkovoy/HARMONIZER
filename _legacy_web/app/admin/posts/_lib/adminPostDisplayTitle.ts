import { ALL_CONTENT_LOCALES, SOURCE_LOCALE, type AppContentLocale } from "../../../../modules/i18n/localeCodes";

export type AdminPostDisplay = {
  locale: AppContentLocale;
  title: string;
  coverUrl: string | null;
};

/**
 * Admin list/chrome: first non-empty title in RU → EN → … order.
 * Cover is taken from the **same** locale (no cross-locale cover fallback).
 */
export function pickAdminPostDisplay(input: {
  title: string;
  cover_url?: string | null;
  title_i18n?: Record<string, string | undefined> | null;
  cover_url_i18n?: Record<string, string | null | undefined> | null;
}): AdminPostDisplay {
  for (const locale of ALL_CONTENT_LOCALES) {
    const title =
      locale === SOURCE_LOCALE
        ? input.title.trim()
        : (input.title_i18n?.[locale] ?? "").trim();
    if (!title) continue;
    const coverRaw =
      locale === SOURCE_LOCALE
        ? input.cover_url
        : input.cover_url_i18n?.[locale];
    const coverUrl = typeof coverRaw === "string" && coverRaw.trim() ? coverRaw.trim() : null;
    return { locale, title, coverUrl };
  }
  return { locale: SOURCE_LOCALE, title: "Без названия", coverUrl: null };
}

/** @deprecated Prefer pickAdminPostDisplay — title only. */
export function adminPostDisplayTitle(
  title: string,
  titleI18n?: Record<string, string | undefined> | null,
): string {
  return pickAdminPostDisplay({ title, title_i18n: titleI18n }).title;
}
