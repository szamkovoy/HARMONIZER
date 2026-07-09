import { Directory, File, Paths } from "expo-file-system";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_DIR = new Directory(Paths.cache, "stories-video");

const inflight = new Map<string, Promise<string | null>>();

function normalize(uri: string | null | undefined): string | null {
  const value = uri?.trim();
  return value ? value : null;
}

function fileNameForRemoteUri(remoteUri: string): string {
  let extension = ".mp4";
  try {
    const url = new URL(remoteUri);
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "story-video.mp4";
    const extMatch = /\.[a-z0-9]+$/i.exec(last);
    extension = extMatch?.[0] ?? ".mp4";
  } catch {
    // Fall through to hashed filename with default extension.
  }

  let hash = 5381;
  for (let i = 0; i < remoteUri.length; i += 1) {
    hash = (hash * 33) ^ remoteUri.charCodeAt(i);
  }
  return `story-${Math.abs(hash >>> 0)}${extension}`;
}

function fileForRemoteUri(remoteUri: string): File {
  return new File(CACHE_DIR, fileNameForRemoteUri(remoteUri));
}

function ensureCacheDir(): void {
  if (!CACHE_DIR.exists) {
    CACHE_DIR.create({ idempotent: true, intermediates: true });
  }
}

function isFresh(file: File): boolean {
  if (!file.exists || !file.size) return false;
  const modifiedAt = file.modificationTime ?? 0;
  return Date.now() - modifiedAt <= CACHE_TTL_MS;
}

function deleteIfStale(file: File): void {
  if (!file.exists) return;
  if (isFresh(file)) return;
  try {
    file.delete();
  } catch {
    // Best effort cleanup only.
  }
}

export function getCachedStoryVideoUri(remoteUri: string | null | undefined): string | null {
  const normalized = normalize(remoteUri);
  if (!normalized) return null;
  ensureCacheDir();
  const file = fileForRemoteUri(normalized);
  deleteIfStale(file);
  return isFresh(file) ? file.uri : null;
}

export async function cacheStoryVideoUri(remoteUri: string | null | undefined): Promise<string | null> {
  const normalized = normalize(remoteUri);
  if (!normalized) return null;

  const cached = getCachedStoryVideoUri(normalized);
  if (cached) return cached;

  const existing = inflight.get(normalized);
  if (existing) return existing;

  const task = (async () => {
    try {
      ensureCacheDir();
      const target = fileForRemoteUri(normalized);
      const downloaded = await File.downloadFileAsync(normalized, target, { idempotent: true });
      return downloaded.exists && downloaded.size ? downloaded.uri : null;
    } catch {
      return null;
    } finally {
      inflight.delete(normalized);
    }
  })();

  inflight.set(normalized, task);
  return task;
}

export async function cacheStoryVideoUris(uris: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(uris.map(normalize).filter(Boolean) as string[])];
  await Promise.all(unique.map((uri) => cacheStoryVideoUri(uri)));
}
