import { Image } from "react-native";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const inflight = new Map<string, Promise<void>>();
const readyAt = new Map<string, number>();

function pruneExpiredPrefetchEntries(now = Date.now()): void {
  for (const [uri, ts] of readyAt) {
    if (now - ts > CACHE_TTL_MS) {
      readyAt.delete(uri);
      inflight.delete(uri);
    }
  }
}

/** Best-effort prefetch; повторные вызовы дедуплицируются. */
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

  const task = Image.prefetch(normalized)
    .then(() => {
      readyAt.set(normalized, Date.now());
    })
    .catch(() => {
      /* Сеть/кэш могут временно отказать — viewer попробует снова при открытии. */
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

export async function prefetchStoryMediaUris(uris: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(uris.map((uri) => uri?.trim()).filter(Boolean) as string[])];
  await Promise.all(unique.map((uri) => prefetchStoryMediaUri(uri)));
}
