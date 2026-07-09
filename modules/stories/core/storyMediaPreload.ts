import { Image } from "expo-image";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PARALLEL_PREFETCH = 4;

const inflight = new Map<string, Promise<boolean>>();
const readyAt = new Map<string, number>();

function pruneExpiredPrefetchEntries(now = Date.now()): void {
  for (const [uri, ts] of readyAt) {
    if (now - ts > CACHE_TTL_MS) {
      readyAt.delete(uri);
      inflight.delete(uri);
    }
  }
}

/**
 * Best-effort preload with native expo-image cache + decode.
 * Unlike RN Image.prefetch, this path warms disk/memory cache and asks the
 * native image pipeline to load/decode the asset before the viewer needs it.
 */
export async function prefetchStoryMediaUri(uri: string | null | undefined): Promise<void> {
  const normalized = uri?.trim();
  if (!normalized) return;

  pruneExpiredPrefetchEntries();

  const cachedAt = readyAt.get(normalized);
  if (cachedAt && Date.now() - cachedAt <= CACHE_TTL_MS) return;

  const pending = inflight.get(normalized);
  if (pending) {
    await pending;
    return;
  }

  const task = Image.prefetch(normalized, "memory-disk")
    .then(async (ok) => {
      if (!ok) return false;
      await Image.loadAsync(normalized);
      readyAt.set(normalized, Date.now());
      return true;
    })
    .catch(() => {
      return false;
    })
    .finally(() => {
      inflight.delete(normalized);
    });

  inflight.set(normalized, task);
  await task;
}

export function isStoryMediaPrefetched(uri: string | null | undefined): boolean {
  const normalized = uri?.trim();
  if (!normalized) return false;
  const cachedAt = readyAt.get(normalized);
  return !!cachedAt && Date.now() - cachedAt <= CACHE_TTL_MS;
}

export function isStoryMediaReady(uri: string | null | undefined): boolean {
  return isStoryMediaPrefetched(uri);
}

export async function prefetchStoryMediaUris(uris: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(uris.map((uri) => uri?.trim()).filter(Boolean) as string[])];
  await runPrefetchQueue(unique);
}

async function runPrefetchQueue(uris: string[]): Promise<void> {
  const queue = [...uris];
  const workers = Array.from({ length: Math.min(MAX_PARALLEL_PREFETCH, queue.length || 1) }, async () => {
    while (queue.length > 0) {
      const uri = queue.shift();
      if (uri) await prefetchStoryMediaUri(uri);
    }
  });
  await Promise.all(workers);
}
