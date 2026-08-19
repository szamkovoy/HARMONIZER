import { Image } from "react-native";
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

import { BOOK_ID, type BookLocale } from "./bookIds";

/**
 * Legacy revision for Metro/dev downloads when no CDN version is provided.
 * CDN path passes `v{BOOK_EPUB_VERSION}` so bumping env invalidates on-device cache.
 */
export const BOOK_EPUB_CACHE_REVISION = "ru-2026-08-13-coldfix";

/** Minimum plausible EPUB size — smaller files are treated as corrupt. */
const MIN_EPUB_BYTES = 500_000;

type CacheMeta = {
  revision: string;
  locale: BookLocale;
  size: number;
};

async function writeMeta(
  metaUri: string,
  locale: BookLocale,
  size: number,
  revision: string,
): Promise<void> {
  const meta: CacheMeta = {
    revision,
    locale,
    size,
  };
  await writeAsStringAsync(metaUri, JSON.stringify(meta));
}

async function materializeToCache(
  sourceUri: string,
  bookLocale: BookLocale,
  cacheRevision: string,
): Promise<string> {
  const root = documentDirectory;
  if (!root) throw new Error("documentDirectory unavailable");

  const dir = `${root}books/`;
  const dest = `${dir}${BOOK_ID}-${bookLocale}.epub`;
  const metaUri = `${dest}.meta.json`;

  const dirInfo = await getInfoAsync(dir);
  if (!dirInfo.exists) {
    await makeDirectoryAsync(dir, { intermediates: true });
  }

  const existing = await getInfoAsync(dest);
  const existingSize = existing.exists && !existing.isDirectory ? (existing.size ?? 0) : 0;

  // Fast path: healthy file on disk with matching revision.
  if (existingSize >= MIN_EPUB_BYTES) {
    try {
      const meta = JSON.parse(await readAsStringAsync(metaUri)) as Partial<CacheMeta>;
      const revisionOk = meta?.revision === cacheRevision;
      const localeOk = !meta?.locale || meta.locale === bookLocale;
      if (revisionOk && localeOk && meta.size === existingSize) {
        return dest;
      }
    } catch {
      /* re-download below when revision mismatch */
    }
    // Stale revision → re-fetch. Missing/corrupt meta with healthy file + same
    // legacy revision still upgrades meta without re-download.
    if (cacheRevision === BOOK_EPUB_CACHE_REVISION) {
      try {
        await writeMeta(metaUri, bookLocale, existingSize, cacheRevision);
        return dest;
      } catch {
        /* fall through to re-download */
      }
    }
  }

  if (existing.exists) {
    await deleteAsync(dest, { idempotent: true });
  }
  try {
    await deleteAsync(metaUri, { idempotent: true });
  } catch {
    /* ignore */
  }

  let outUri: string;
  if (sourceUri.startsWith("http://") || sourceUri.startsWith("https://")) {
    const result = await downloadAsync(sourceUri, dest);
    if (!result.uri) throw new Error("epub download failed");
    outUri = result.uri;
  } else if (sourceUri.startsWith("file://")) {
    await copyAsync({ from: sourceUri, to: dest });
    outUri = dest;
  } else {
    const result = await downloadAsync(sourceUri, dest);
    if (!result.uri) throw new Error("epub materialize failed");
    outUri = result.uri;
  }

  const written = await getInfoAsync(outUri);
  const size = written.exists && !written.isDirectory ? (written.size ?? 0) : 0;
  if (size < MIN_EPUB_BYTES) {
    throw new Error("epub materialize produced an empty file");
  }
  await writeMeta(metaUri, bookLocale, size, cacheRevision);
  return outUri;
}

/** On-disk EPUB when revision matches (skip CDN probe/download). */
export async function peekCachedBookEpub(
  bookLocale: BookLocale,
  cacheRevision: string,
): Promise<string | null> {
  const root = documentDirectory;
  if (!root) return null;

  const dest = `${root}books/${BOOK_ID}-${bookLocale}.epub`;
  const metaUri = `${dest}.meta.json`;
  const existing = await getInfoAsync(dest);
  const existingSize = existing.exists && !existing.isDirectory ? (existing.size ?? 0) : 0;
  if (existingSize < MIN_EPUB_BYTES) return null;

  try {
    const meta = JSON.parse(await readAsStringAsync(metaUri)) as Partial<CacheMeta>;
    if (
      meta?.revision === cacheRevision &&
      (!meta.locale || meta.locale === bookLocale) &&
      meta.size === existingSize
    ) {
      return dest;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Materialize the bundled EPUB to a stable `file://…/*.epub` URI.
 * Reuses any healthy on-device copy (avoids multi-minute Metro re-download).
 */
export async function resolveBookSrc(assetModule: number, bookLocale: BookLocale): Promise<string> {
  const resolved = Image.resolveAssetSource(assetModule);
  const uri = resolved?.uri;
  if (!uri) throw new Error("asset uri missing");
  return materializeToCache(uri, bookLocale, BOOK_EPUB_CACHE_REVISION);
}

/** HTTP EPUB (CDN or Metro `/hz-book`) → on-device cache keyed by `cacheRevision`. */
export async function resolveBookSrcFromUrl(
  url: string,
  bookLocale: BookLocale,
  cacheRevision: string = BOOK_EPUB_CACHE_REVISION,
): Promise<string> {
  return materializeToCache(url, bookLocale, cacheRevision);
}
