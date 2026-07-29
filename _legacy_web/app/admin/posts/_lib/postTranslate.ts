import { ALL_CONTENT_LOCALES, type AppContentLocale } from "../../../../modules/i18n/localeCodes";

export const POST_TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
export type PostTargetLocale = (typeof POST_TARGET_LOCALES)[number];
export type PostContentLocale = AppContentLocale;

export type LocaleTabSource = { title: string; body: string };

/**
 * Source for «Перевести»: prefer the active tab when it has a title,
 * then RU → EN → remaining TARGET_LOCALES.
 */
export function pickPostTranslateSource(
  activeTab: PostContentLocale,
  ru: LocaleTabSource,
  localeTabs: Record<PostTargetLocale, LocaleTabSource>,
): { locale: PostContentLocale; title: string; body: string } | null {
  if (activeTab === "ru" && ru.title.trim()) {
    return { locale: "ru", title: ru.title.trim(), body: ru.body };
  }
  if (activeTab !== "ru") {
    const tab = localeTabs[activeTab];
    if (tab.title.trim()) {
      return { locale: activeTab, title: tab.title.trim(), body: tab.body };
    }
  }
  if (ru.title.trim()) {
    return { locale: "ru", title: ru.title.trim(), body: ru.body };
  }
  for (const locale of POST_TARGET_LOCALES) {
    const tab = localeTabs[locale];
    if (tab.title.trim()) {
      return { locale, title: tab.title.trim(), body: tab.body };
    }
  }
  return null;
}

/**
 * Locales to fill: empty tabs only.
 * RU → all other languages. Non-RU source (e.g. EN) → other empty languages except RU.
 */
export function localesMissingPostContent(
  localeTabs: Record<PostTargetLocale, LocaleTabSource>,
  sourceLocale: PostContentLocale,
): PostContentLocale[] {
  const missing: PostContentLocale[] = [];
  for (const locale of POST_TARGET_LOCALES) {
    if (locale === sourceLocale) continue;
    if (!localeTabs[locale].title.trim()) missing.push(locale);
  }
  // RU is never in POST_TARGET_LOCALES — non-RU sources never fill Russian.
  return missing;
}

/** Defense: strip `ru` from fill list when source is not Russian. */
export function sanitizePostFillLocales(
  sourceLocale: PostContentLocale,
  fillLocales: readonly string[],
): PostContentLocale[] {
  const allowed = new Set<string>(ALL_CONTENT_LOCALES);
  return fillLocales
    .filter((l): l is PostContentLocale => allowed.has(l))
    .filter((l) => l !== sourceLocale)
    .filter((l) => sourceLocale === "ru" || l !== "ru");
}
