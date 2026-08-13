import type { BookLocale } from "./bookIds";

/**
 * Metro-bundled EPUB module id — intentionally unused in Phase A Dev.
 *
 * Large `require("*.epub")` under assets/books made Dev Client cold start
 * crawl/download unusable (black screen / Downloading 1%/min). Both RU and EN
 * are served from Book/build via Metro GET /hz-book/{locale}.epub — see
 * openBookSrc + metro.config.js. Phase B CDN will replace this path.
 */
export function bookAssetModule(_bookLocale: BookLocale): number | null {
  return null;
}
