/**
 * Persist edge-trim windows for affirmation voice (local device cache).
 * Playback applies trim via position/stop; file itself is not rewritten.
 */
import {
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

import type { AudioEdgeTrim } from "@/modules/affirmations/core/recordingSpeechTracker";

export type { AudioEdgeTrim } from "@/modules/affirmations/core/recordingSpeechTracker";
export {
  AUDIO_EDGE_KEEP_MS,
  RecordingSpeechTracker,
} from "@/modules/affirmations/core/recordingSpeechTracker";

const TRIM_DIR = `${documentDirectory ?? ""}affirmation-audio-trim/`;

function trimFileUri(audioPath: string): string {
  const safe = audioPath.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return `${TRIM_DIR}${safe}.json`;
}

async function ensureTrimDir(): Promise<void> {
  if (!documentDirectory) return;
  const info = await getInfoAsync(TRIM_DIR);
  if (!info.exists) await makeDirectoryAsync(TRIM_DIR, { intermediates: true });
}

export async function saveAudioEdgeTrim(
  audioPath: string,
  trim: AudioEdgeTrim | null,
): Promise<void> {
  if (!documentDirectory || !audioPath) return;
  try {
    await ensureTrimDir();
    const uri = trimFileUri(audioPath);
    if (!trim) {
      const info = await getInfoAsync(uri);
      if (info.exists) await deleteAsync(uri, { idempotent: true });
      return;
    }
    await writeAsStringAsync(uri, JSON.stringify(trim));
  } catch {
    /* best-effort local cache */
  }
}

export async function loadAudioEdgeTrim(
  audioPath: string | null | undefined,
): Promise<AudioEdgeTrim | null> {
  if (!documentDirectory || !audioPath) return null;
  try {
    const uri = trimFileUri(audioPath);
    const info = await getInfoAsync(uri);
    if (!info.exists) return null;
    const parsed = JSON.parse(await readAsStringAsync(uri)) as Partial<AudioEdgeTrim>;
    if (
      typeof parsed.startMs !== "number" ||
      typeof parsed.endMs !== "number" ||
      parsed.endMs <= parsed.startMs
    ) {
      return null;
    }
    return { startMs: parsed.startMs, endMs: parsed.endMs };
  } catch {
    return null;
  }
}
