import { Image } from "react-native";
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
} from "expo-file-system/legacy";

import { BOOK_ID, type BookLocale } from "./bookIds";

/**
 * Materialize the bundled EPUB to a stable `file://…/*.epub` URI.
 * Metro asset URLs work for some loads, but epub.js is more reliable with a local file.
 */
export async function resolveBookSrc(assetModule: number, bookLocale: BookLocale): Promise<string> {
  const resolved = Image.resolveAssetSource(assetModule);
  const uri = resolved?.uri;
  if (!uri) throw new Error("asset uri missing");

  const root = documentDirectory;
  if (!root) throw new Error("documentDirectory unavailable");

  const dir = `${root}books/`;
  const dest = `${dir}${BOOK_ID}-${bookLocale}.epub`;

  const dirInfo = await getInfoAsync(dir);
  if (!dirInfo.exists) {
    await makeDirectoryAsync(dir, { intermediates: true });
  }

  const existing = await getInfoAsync(dest);
  // In Dev Client always refresh from Metro asset so EPUB rebuilds are picked up.
  if (!__DEV__ && existing.exists && !existing.isDirectory && (existing.size ?? 0) > 0) {
    return dest;
  }
  if (existing.exists) {
    await deleteAsync(dest, { idempotent: true });
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const result = await downloadAsync(uri, dest);
    if (!result.uri) throw new Error("epub download failed");
    return result.uri;
  }

  if (uri.startsWith("file://")) {
    await copyAsync({ from: uri, to: dest });
    return dest;
  }

  // Fallback: try download (some platforms return asset:// or similar)
  const result = await downloadAsync(uri, dest);
  if (!result.uri) throw new Error("epub materialize failed");
  return result.uri;
}
