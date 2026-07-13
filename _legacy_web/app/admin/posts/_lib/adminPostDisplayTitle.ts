import { ALL_CONTENT_LOCALES, SOURCE_LOCALE } from "../../../../modules/i18n/localeCodes";

/** Admin list title: RU → EN → rest of ALL_CONTENT_LOCALES. */
export function adminPostDisplayTitle(
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
