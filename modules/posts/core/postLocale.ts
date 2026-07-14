import {
  pickExactLocalizedText,
  pickExactLocalizedUrl,
  pickLocalizedText,
} from "@/modules/i18n/pickLocalizedContent";
import { SOURCE_LOCALE, type AppContentLocale } from "@/modules/i18n/localeCodes";

export type PostLocaleFields = {
  title: string;
  body: string;
  coverUrl: string | null;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  coverUrlI18n: Record<string, string>;
};

/**
 * True when the post has an authored title for this UI locale exactly
 * (no en/ru fallback — Videos tab must not mix languages).
 */
export function postAvailableInLocale(source: PostLocaleFields, locale: AppContentLocale): boolean {
  return Boolean(pickExactLocalizedText(locale, source.title, source.titleI18n));
}

/**
 * Locale-exact title/body/cover. Returns null when this locale has no title.
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

  const title = pickExactLocalizedText(locale, source.title, source.titleI18n);
  const body = pickExactLocalizedText(locale, source.body, source.bodyI18n);
  const cover = pickExactLocalizedUrl(locale, source.coverUrl, source.coverUrlI18n);
  return { title, body, coverUrl: cover };
}

/** Admin list / chrome: RU → EN → … first non-empty title (soft). */
export function pickPostDisplayTitle(
  title: string,
  titleI18n?: Record<string, string | undefined> | null,
): string {
  return pickLocalizedText(SOURCE_LOCALE, title, titleI18n) || "Без названия";
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
  for (const locale of ["en", "de", "fr", "it", "es", "pt", "nl"] as const) {
    const title = (fields.titleI18n[locale] ?? "").trim();
    if (title) {
      return { locale, title, body: fields.bodyI18n[locale] ?? "" };
    }
  }
  return null;
}
