/**
 * Affirmation intake/refine can be up to ~3 minutes — communicator’s 10–12s
 * STT budget is too short and surfaces as «Не удалось распознать речь».
 * Timeout scales with file size (long takes need more Whisper time).
 */
import { getInfoAsync, readAsStringAsync } from "expo-file-system/legacy";

import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import {
  transcribeCommunicatorAudio,
  type TranscribeAudioResponse,
} from "@/services/communicator-client";

const MAX_ATTEMPTS = 2;
const RETRY_GAP_MS = 600;
/** Floor / ceiling for a single Whisper attempt (3 min AAC ≈ several MB). */
const MIN_ATTEMPT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPT_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutForAudioBytes(sizeBytes: number): number {
  // ~1s of headroom per 8 KB of payload, clamped.
  const scaled = Math.round(sizeBytes / 8);
  return Math.min(MAX_ATTEMPT_TIMEOUT_MS, Math.max(MIN_ATTEMPT_TIMEOUT_MS, scaled));
}

export async function transcribeAffirmationRecording(params: {
  uri: string;
  language?: string;
}): Promise<TranscribeAudioResponse> {
  const info = await getInfoAsync(params.uri);
  const size = info.exists && !info.isDirectory ? Number(info.size ?? 0) : 0;
  if (!size || size < 16) {
    throw new Error("empty_audio");
  }

  const mimeType = mimeFromRecordingUri(params.uri);
  const base64 = await readAsStringAsync(params.uri, { encoding: "base64" });
  const timeoutMs = timeoutForAudioBytes(size);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await transcribeCommunicatorAudio(
        {
          mimeType,
          base64,
          language: params.language,
        },
        { useNetworkRetry: false, timeoutMs },
      );
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_GAP_MS);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
