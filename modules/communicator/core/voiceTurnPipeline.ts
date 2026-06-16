import { deleteAsync, readAsStringAsync } from "expo-file-system/legacy";

import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import {
  transcribeCommunicatorAudio,
  type TranscribeAudioResponse,
} from "@/services/communicator-client";

/** Одна попытка расшифровки; при зависании — следующая попытка через короткую паузу. */
export const VOICE_TRANSCRIBE_ATTEMPT_MS = 10_000;
export const VOICE_TRANSCRIBE_MAX_ATTEMPTS = 3;
const RETRY_GAP_MS = [400, 800] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetainedVoiceRecording = {
  uri: string;
  durationMs: number;
  transcribedText?: string;
  /** Id пузыря в `messages` на время расшифровки / повтора */
  pendingVoiceId?: string;
};

export async function deleteVoiceRecordingFile(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    await deleteAsync(uri, { idempotent: true });
  } catch {
    /* cache file may already be gone */
  }
}

/**
 * Transcribe audio at `uri` with bounded wait per attempt (no multi-minute spinner).
 */
export async function transcribeVoiceRecording(params: {
  uri: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<TranscribeAudioResponse> {
  const mimeType = mimeFromRecordingUri(params.uri);
  const base64 = await readAsStringAsync(params.uri, { encoding: "base64" });

  let lastError: unknown;
  for (let attempt = 0; attempt < VOICE_TRANSCRIBE_MAX_ATTEMPTS; attempt++) {
    if (params.signal?.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }

    const attemptController = new AbortController();
    const timeoutId = setTimeout(() => attemptController.abort(), VOICE_TRANSCRIBE_ATTEMPT_MS);
    params.signal?.addEventListener("abort", () => attemptController.abort(), { once: true });

    try {
      return await transcribeCommunicatorAudio(
        {
          mimeType,
          base64,
          language: params.language,
          signal: attemptController.signal,
        },
        { useNetworkRetry: false },
      );
    } catch (error) {
      lastError = error;
      if (attempt < VOICE_TRANSCRIBE_MAX_ATTEMPTS - 1) {
        await sleep(RETRY_GAP_MS[attempt] ?? 800);
        continue;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
