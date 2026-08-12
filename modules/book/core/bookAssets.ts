import type { BookLocale } from "./bookIds";

/**
 * Metro asset entry for the EPUB. Keep this module out of the profile/tabs
 * import graph — requiring the ~14MB file + epub.js at startup freezes the app.
 */
export function bookAssetModule(bookLocale: BookLocale): number | null {
  // Phase A: only RU. EN needs `node scripts/book-build-epub.mjs en` + a require below.
  if (bookLocale === "ru") {
    return require("../../../assets/books/yoga-wizards-path-ru.epub");
  }
  return null;
}
