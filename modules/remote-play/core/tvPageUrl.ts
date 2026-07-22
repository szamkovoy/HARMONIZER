import type { AppContentLocale } from "@/modules/i18n/localeCodes";

/** Public Remote Play page (WordPress). No trailing slash — shorter to type. */
export const TV_PAGE_BASE_URL = "https://zamkovoi.yoga/tv";

/**
 * Compact TV page URL with locale hint: `https://zamkovoi.yoga/tv?pt`.
 * Russian omits the query (page default UI = ru).
 */
export function tvPageUrl(locale: AppContentLocale = "ru"): string {
  if (locale === "ru") return TV_PAGE_BASE_URL;
  return `${TV_PAGE_BASE_URL}?${encodeURIComponent(locale)}`;
}
