import { Audio, type AVPlaybackStatus, type AVPlaybackStatusToSet } from "expo-av";

import type { AudioEdgeTrim } from "@/modules/affirmations/core/recordingSpeechTracker";

const FADE_MS = 500;
const FADE_STEPS = 10;

async function sleep(ms: number) {
  await new Promise<void>((r) => setTimeout(r, ms));
}

async function fadeVolume(sound: Audio.Sound, from: number, to: number, ms: number) {
  const stepMs = Math.max(16, Math.floor(ms / FADE_STEPS));
  for (let i = 1; i <= FADE_STEPS; i += 1) {
    const t = i / FADE_STEPS;
    const v = from + (to - from) * t;
    try {
      await sound.setVolumeAsync(Math.max(0, Math.min(1, v)));
    } catch {
      return;
    }
    await sleep(stepMs);
  }
}

/**
 * Play affirmation voice with ~0.5s fade in/out (manage preview + breath overlay).
 * Optional edge trim skips long silence while leaving ~1s pads for fades.
 */
export async function playAffirmationAudio(
  uri: string,
  options?: { onFinished?: () => void; trim?: AudioEdgeTrim | null },
): Promise<Audio.Sound> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });
  const { sound } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: false, volume: 0 } satisfies AVPlaybackStatusToSet,
  );
  const trim = options?.trim ?? null;
  const trimStart = trim && trim.startMs > 0 ? trim.startMs : 0;
  const trimEnd = trim && trim.endMs > trimStart ? trim.endMs : null;
  let fadingOut = false;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    options?.onFinished?.();
    void sound.unloadAsync().catch(() => undefined);
  };

  sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (status.didJustFinish) {
      finish();
      return;
    }
    const pos = status.positionMillis;
    const naturalDur = status.durationMillis;
    const effectiveEnd =
      trimEnd ??
      (typeof naturalDur === "number" && Number.isFinite(naturalDur) ? naturalDur : null);
    if (typeof pos !== "number") return;
    if (effectiveEnd != null && pos >= effectiveEnd) {
      void sound.stopAsync().then(finish).catch(() => finish());
      return;
    }
    if (
      !fadingOut &&
      effectiveEnd != null &&
      effectiveEnd - trimStart > FADE_MS * 2 &&
      pos >= effectiveEnd - FADE_MS
    ) {
      fadingOut = true;
      void fadeVolume(sound, 1, 0, FADE_MS);
    }
  });

  if (trimStart > 0) {
    try {
      await sound.setPositionAsync(trimStart);
    } catch {
      /* play from 0 if seek fails */
    }
  }
  await sound.playAsync();
  void fadeVolume(sound, 0, 1, FADE_MS);
  return sound;
}
