import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

import { BOOK_ID, type BookLocale } from "./bookIds";

export type ReadingProgress = {
  locator: string;
  percent?: number;
  chapterLabel?: string;
  /** Visible text near focus — helps restore after font reflow. */
  snippet?: string;
  href?: string;
  updatedAt: string;
};

function progressUri(userId: string, locale: BookLocale): string {
  return `${documentDirectory ?? ""}book-progress/${BOOK_ID}_${locale}_${userId}.json`;
}

async function ensureDir(): Promise<void> {
  if (!documentDirectory) return;
  const dir = `${documentDirectory}book-progress/`;
  const info = await getInfoAsync(dir);
  if (!info.exists) {
    await makeDirectoryAsync(dir, { intermediates: true });
  }
}

export async function loadReadingProgress(
  userId: string,
  locale: BookLocale,
): Promise<ReadingProgress | null> {
  try {
    if (!documentDirectory) return null;
    const uri = progressUri(userId, locale);
    const info = await getInfoAsync(uri);
    if (!info.exists) return null;
    const parsed = JSON.parse(await readAsStringAsync(uri)) as ReadingProgress;
    if (!parsed?.locator) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveReadingProgress(
  userId: string,
  locale: BookLocale,
  progress: Omit<ReadingProgress, "updatedAt"> & { updatedAt?: string },
): Promise<ReadingProgress> {
  if (!documentDirectory) {
    return {
      locator: progress.locator,
      percent: progress.percent,
      chapterLabel: progress.chapterLabel,
      snippet: progress.snippet,
      href: progress.href,
      updatedAt: progress.updatedAt ?? new Date().toISOString(),
    };
  }
  await ensureDir();
  const payload: ReadingProgress = {
    locator: progress.locator,
    percent: progress.percent,
    chapterLabel: progress.chapterLabel,
    snippet: progress.snippet,
    href: progress.href,
    updatedAt: progress.updatedAt ?? new Date().toISOString(),
  };
  await writeAsStringAsync(progressUri(userId, locale), JSON.stringify(payload));
  return payload;
}
