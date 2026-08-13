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
 * Bump only when `assets/books/yoga-wizards-path-*.epub` is intentionally replaced.
 * Do NOT key the on-device cache on Metro’s HTTP asset URI — `expo start -c`
 * changes that hash and used to force a multi‑minute re-download every time.
 */
export const BOOK_EPUB_CACHE_REVISION = "ru-2026-08-12-7835277";

/** Minimum plausible EPUB size — smaller files are treated as corrupt. */
const MIN_EPUB_BYTES = 500_000;

type CacheMeta = {
  revision: string;
  locale: BookLocale;
  size: number;
};

async function writeMeta(metaUri: string, locale: BookLocale, size: number): Promise<void> {
  const meta: CacheMeta = {
    revision: BOOK_EPUB_CACHE_REVISION,
    locale,
    size,
  };
  await writeAsStringAsync(metaUri, JSON.stringify(meta));
}

/**
 * Materialize the bundled EPUB to a stable `file://…/*.epub` URI.
 * Reuses any healthy on-device copy (avoids multi-minute Metro re-download).
 */
export async function resolveBookSrc(assetModule: number, bookLocale: BookLocale): Promise<string> {
  const resolved = Image.resolveAssetSource(assetModule);
  const uri = resolved?.uri;
  if (!uri) throw new Error("asset uri missing");

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

  // Fast path: healthy file on disk — never re-fetch from Metro just because meta is old/missing.
  if (existingSize >= MIN_EPUB_BYTES) {
    try {
      const meta = JSON.parse(await readAsStringAsync(metaUri)) as Partial<CacheMeta> & {
        sourceUri?: string;
      };
      const revisionOk = meta?.revision === BOOK_EPUB_CACHE_REVISION;
      const localeOk = !meta?.locale || meta.locale === bookLocale;
      if (revisionOk && localeOk && meta.size === existingSize) {
        return dest;
      }
    } catch {
      /* upgrade meta below */
    }
    try {
      await writeMeta(metaUri, bookLocale, existingSize);
    } catch {
      /* best effort */
    }
    return dest;
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
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const result = await downloadAsync(uri, dest);
    if (!result.uri) throw new Error("epub download failed");
    outUri = result.uri;
  } else if (uri.startsWith("file://")) {
    await copyAsync({ from: uri, to: dest });
    outUri = dest;
  } else {
    const result = await downloadAsync(uri, dest);
    if (!result.uri) throw new Error("epub materialize failed");
    outUri = result.uri;
  }

  const written = await getInfoAsync(outUri);
  const size = written.size ?? 0;
  if (size < MIN_EPUB_BYTES) {
    throw new Error("epub materialize produced an empty file");
  }
  await writeMeta(metaUri, bookLocale, size);
  return outUri;
}
