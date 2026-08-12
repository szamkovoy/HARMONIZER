import { useCallback, useState } from "react";
import {
  bundleDirectory,
  cacheDirectory,
  createDownloadResumable,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

/**
 * FileSystem adapter for `@epubjs-react-native/core` on Expo SDK 54+.
 *
 * The stock `@epubjs-react-native/expo-file-system` imports the new
 * `expo-file-system` entry, where `writeAsStringAsync` only throws a deprecation
 * error ("failed to write jszip js file"). Legacy API still works.
 */
export function useBookFileSystem() {
  const [file, setFile] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [size, setSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const downloadFile = useCallback(async (fromUrl: string, toFile: string) => {
    const callback = (downloadProgress: {
      totalBytesWritten: number;
      totalBytesExpectedToWrite: number;
    }) => {
      const expected = downloadProgress.totalBytesExpectedToWrite;
      if (!expected) return;
      setProgress(Math.round((downloadProgress.totalBytesWritten / expected) * 100));
    };

    const dest = `${documentDirectory ?? ""}${toFile}`;
    const downloadResumable = createDownloadResumable(fromUrl, dest, { cache: true }, callback);
    setDownloading(true);
    try {
      const value = await downloadResumable.downloadAsync();
      if (!value) throw new Error("Download failed");
      const contentLength = value.headers?.["Content-Length"] ?? value.headers?.["content-length"];
      if (contentLength) setSize(Number(contentLength));
      setSuccess(true);
      setError(null);
      setFile(value.uri);
      return { uri: value.uri, mimeType: value.mimeType ?? null };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error downloading file");
      return { uri: null, mimeType: null };
    } finally {
      setDownloading(false);
    }
  }, []);

  const getFileInfo = useCallback(async (fileUri: string) => {
    const info = await getInfoAsync(fileUri);
    return {
      uri: info.uri,
      exists: info.exists,
      isDirectory: info.exists ? Boolean(info.isDirectory) : false,
      size: info.exists && !info.isDirectory ? info.size : undefined,
    };
  }, []);

  return {
    file,
    progress,
    downloading,
    size,
    error,
    success,
    documentDirectory,
    cacheDirectory,
    bundleDirectory: bundleDirectory || undefined,
    readAsStringAsync,
    writeAsStringAsync,
    deleteAsync,
    downloadFile,
    getFileInfo,
  };
}
