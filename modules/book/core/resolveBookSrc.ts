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

type CacheMeta = { sourceUri: string; size: number };

/**
 * Materialize the bundled EPUB to a stable `file://…/*.epub` URI.
 * Caches on disk: Dev Client used to re-download the whole EPUB from Metro on
 * every open (minutes on slow links). Re-fetch only when the asset URI changes.
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
  if (existing.exists && !existing.isDirectory && (existing.size ?? 0) > 0) {
    try {
      const meta = JSON.parse(await readAsStringAsync(metaUri)) as CacheMeta;
      if (meta?.sourceUri === uri && meta.size === existing.size) {
        return dest;
      }
    } catch {
      /* stale/missing meta → refresh */
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
  const meta: CacheMeta = { sourceUri: uri, size: written.size ?? 0 };
  await writeAsStringAsync(metaUri, JSON.stringify(meta));
  return outUri;
}
