import { bookDevEpubUrl } from "./bookDevUrl";
import type { BookLocale } from "./bookIds";
import { resolveBookSrcFromUrl } from "./resolveBookSrc";

/**
 * Resolve a readable `file://` EPUB URI for the active book locale.
 *
 * Phase A Dev: always download from Metro `/hz-book/{locale}.epub` (files in
 * `Book/build/{locale}/book.epub`). No `require()` of multi‑MB epubs into the
 * Metro asset graph — that caused black screen / tiny Downloading % on device.
 */
export async function openBookSrc(bookLocale: BookLocale): Promise<string> {
  const url = bookDevEpubUrl(bookLocale);
  if (!url) {
    throw new Error(`Book ${bookLocale}: Metro Dev URL unavailable (is expo start running?)`);
  }
  return resolveBookSrcFromUrl(url, bookLocale);
}
