/**
 * Disk cache for affirmation voice: signed HTTPS URLs are slow to open via
 * expo-av on first play (~seconds). Download once keyed by storage path.
 */
import {
  cacheDirectory,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
} from "expo-file-system/legacy";

const CACHE_DIR = `${cacheDirectory ?? ""}affirmation-audio-cache/`;

function safeName(audioPath: string): string {
  return audioPath.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

function localUriFor(audioPath: string): string {
  return `${CACHE_DIR}${safeName(audioPath)}`;
}

async function ensureCacheDir(): Promise<boolean> {
  if (!cacheDirectory) return false;
  try {
    const info = await getInfoAsync(CACHE_DIR);
    if (!info.exists) await makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    return true;
  } catch {
    return false;
  }
}

/** Prefer local file:// for playback; fall back to the remote signed URL. */
export async function resolveAffirmationPlaybackUri(
  audioPath: string | null | undefined,
  remoteUri: string,
): Promise<string> {
  if (!audioPath || remoteUri.startsWith("file:")) return remoteUri;
  if (!(await ensureCacheDir())) return remoteUri;
  const local = localUriFor(audioPath);
  try {
    const info = await getInfoAsync(local);
    if (info.exists && !info.isDirectory && Number(info.size ?? 0) > 16) {
      return local;
    }
    const result = await downloadAsync(remoteUri, local);
    return result.uri || local;
  } catch {
    return remoteUri;
  }
}

/** Best-effort download so later play hits disk, not the network. */
export async function warmAffirmationAudioCache(
  audioPath: string | null | undefined,
  remoteUri: string | null | undefined,
): Promise<string | null> {
  if (!remoteUri) return null;
  return resolveAffirmationPlaybackUri(audioPath, remoteUri);
}
