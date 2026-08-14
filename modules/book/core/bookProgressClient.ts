import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";

import { BOOK_ID, type BookLocale } from "./bookIds";
import type { ReadingProgress } from "./readingProgress";

export type RemoteReadingProgress = ReadingProgress;

function serialize(progress: ReadingProgress) {
  return {
    bookId: BOOK_ID,
    locator: progress.locator,
    percent: progress.percent,
    chapterLabel: progress.chapterLabel,
    snippet: progress.snippet,
    href: progress.href,
    updatedAt: progress.updatedAt,
  };
}

export async function fetchRemoteReadingProgress(
  locale: BookLocale,
): Promise<RemoteReadingProgress | null> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const qs = new URLSearchParams({ bookId: BOOK_ID, locale });
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/book/progress?${qs}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { progress?: RemoteReadingProgress | null };
    const p = data.progress;
    if (!p?.locator || !p.updatedAt) return null;
    return {
      locator: p.locator,
      percent: p.percent,
      chapterLabel: p.chapterLabel,
      snippet: p.snippet,
      href: p.href,
      updatedAt: p.updatedAt,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Best-effort PUT; ignores network failures so reading is never blocked. */
export async function pushRemoteReadingProgress(
  locale: BookLocale,
  progress: ReadingProgress,
): Promise<RemoteReadingProgress | null> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/book/progress`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...serialize(progress), locale }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      progress?: RemoteReadingProgress | null;
    };
    return data.progress?.locator ? data.progress : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Prefer the newer of local vs remote by updatedAt (last-write-wins). */
export function pickNewerProgress(
  local: ReadingProgress | null,
  remote: ReadingProgress | null,
): ReadingProgress | null {
  if (!local) return remote;
  if (!remote) return local;
  const localMs = Date.parse(local.updatedAt);
  const remoteMs = Date.parse(remote.updatedAt);
  if (!Number.isFinite(localMs)) return remote;
  if (!Number.isFinite(remoteMs)) return local;
  return remoteMs >= localMs ? remote : local;
}
