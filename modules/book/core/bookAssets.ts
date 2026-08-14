import type { BookLocale } from "./bookIds";

/**
 * Metro-bundled EPUB module id — unused.
 * Phase B: CDN via `/api/book/manifest`. Development still falls back to
 * Metro GET `/hz-book/{locale}.epub` when CDN locale is missing.
 */
export function bookAssetModule(_bookLocale: BookLocale): number | null {
  return null;
}
