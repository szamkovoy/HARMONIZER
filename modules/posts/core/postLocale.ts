import { ALL_CONTENT_LOCALES, SOURCE_LOCALE, type AppContentLocale } from "@/modules/i18n/localeCodes";

export type PostLocaleFields = {
  title: string;
  body: string;
  coverUrl: string | null;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  coverUrlI18n: Record<string, string>;
};

/** True when the post has an authored title for this UI locale (no cross-locale fallback). */
export function postAvailableInLocale(source: PostLocaleFields, locale: AppContentLocale): boolean {
  if (locale === SOURCE_LOCALE) return Boolean(source.title.trim());
  return Boolean((source.titleI18n[locale] ?? "").trim());
}

/**
 * Locale-native title/body/cover. Returns null when the post was not authored
 * for `locale` (caller should hide the card / banner / detail).
 * Cover may fall back to RU only when the locale has title/body.
 */
export function resolvePostContentForLocale(
  source: PostLocaleFields,
  locale: AppContentLocale,
): { title: string; body: string; coverUrl: string | null } | null {
  if (!postAvailableInLocale(source, locale)) return null;
  if (locale === SOURCE_LOCALE) {
    return {
      title: source.title.trim(),
      body: source.body,
      coverUrl: source.coverUrl?.trim() || null,
    };
  }
  const title = (source.titleI18n[locale] ?? "").trim();
  const body = source.bodyI18n[locale] ?? "";
  const cover =
    (source.coverUrlI18n[locale] ?? "").trim() || source.coverUrl?.trim() || null;
  return { title, body, coverUrl: cover };
}

/** Admin list / chrome: RU → EN → … first non-empty title. */
export function pickPostDisplayTitle(
  title: string,
  titleI18n?: Record<string, string | undefined> | null,
): string {
  const ru = title.trim();
  if (ru) return ru;
  for (const locale of ALL_CONTENT_LOCALES) {
    if (locale === SOURCE_LOCALE) continue;
    const value = (titleI18n?.[locale] ?? "").trim();
    if (value) return value;
  }
  return "Без названия";
}

/** Preferred source for LLM translate: RU → EN → rest of ALL_CONTENT_LOCALES. */
export function pickPostTranslateSource(fields: {
  title: string;
  body: string;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
}): { locale: AppContentLocale; title: string; body: string } | null {
  const ruTitle = fields.title.trim();
  if (ruTitle) {
    return { locale: SOURCE_LOCALE, title: ruTitle, body: fields.body };
  }
  for (const locale of ALL_CONTENT_LOCALES) {
    if (locale === SOURCE_LOCALE) continue;
    const title = (fields.titleI18n[locale] ?? "").trim();
    if (title) {
      return { locale, title, body: fields.bodyI18n[locale] ?? "" };
    }
  }
  return null;
}
