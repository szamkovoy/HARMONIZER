import { bookDevEpubUrl } from "./bookDevUrl";
import type { BookLocale } from "./bookIds";
import { fetchBookManifest } from "./bookManifestClient";
import { BOOK_EPUB_CACHE_REVISION, peekCachedBookEpub, resolveBookSrcFromUrl } from "./resolveBookSrc";

function isDevelopmentAppEnv(): boolean {
  return (process.env.EXPO_PUBLIC_APP_ENV ?? "").trim().toLowerCase() === "development";
}

async function probeUrlOk(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  try {
    const head = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (head.ok) return true;
    // Some hosts reject HEAD — try a tiny ranged GET.
    if (head.status === 405 || head.status === 501) {
      const get = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
      });
      return get.ok || get.status === 206;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve a readable `file://` EPUB URI for the active book locale.
 *
 * Phase B: CDN via `/api/book/manifest` (cache keyed by version).
 * Development: if CDN missing/404 for a locale still being translated → Metro `/hz-book`.
 */
export async function openBookSrc(bookLocale: BookLocale): Promise<string> {
  try {
    const manifest = await fetchBookManifest(bookLocale);
    const cacheRevision = `cdn-v${manifest.version}`;
    const cached = await peekCachedBookEpub(bookLocale, cacheRevision);
    if (cached) return cached;

    const ok = await probeUrlOk(manifest.epubUrl);
    if (ok) {
      return resolveBookSrcFromUrl(manifest.epubUrl, bookLocale, cacheRevision);
    }
    if (!isDevelopmentAppEnv()) {
      throw new Error("book_cdn_unavailable");
    }
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (!isDevelopmentAppEnv()) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    // Dev unlock / translator path: fall through to Metro for missing CDN locales.
    if (
      code !== "book_not_owned" &&
      code !== "book_auth_required" &&
      code !== "book_cdn_unavailable" &&
      !code.startsWith("book_manifest") &&
      code !== "invalid_locale"
    ) {
      // Network blip while owned — still try Metro in development.
    } else if (code === "book_not_owned" || code === "book_auth_required") {
      // Dev unlock may open reader without ownership; Metro still needed.
    }
  }

  const url = bookDevEpubUrl(bookLocale);
  if (!url) {
    throw new Error(`Book ${bookLocale}: Metro Dev URL unavailable (is expo start running?)`);
  }
  return resolveBookSrcFromUrl(url, bookLocale, BOOK_EPUB_CACHE_REVISION);
}
