import { Audio, type AVPlaybackStatus, type AVPlaybackStatusToSet } from "expo-av";

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
 */
export async function playAffirmationAudio(
  uri: string,
  options?: { onFinished?: () => void },
): Promise<Audio.Sound> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });
  const { sound } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: false, volume: 0 } satisfies AVPlaybackStatusToSet,
  );
  let fadingOut = false;
  sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (status.didJustFinish) {
      options?.onFinished?.();
      void sound.unloadAsync().catch(() => undefined);
      return;
    }
    const dur = status.durationMillis;
    const pos = status.positionMillis;
    if (
      !fadingOut &&
      typeof dur === "number" &&
      dur > FADE_MS * 2 &&
      typeof pos === "number" &&
      pos >= dur - FADE_MS
    ) {
      fadingOut = true;
      void fadeVolume(sound, 1, 0, FADE_MS);
    }
  });
  await sound.playAsync();
  void fadeVolume(sound, 0, 1, FADE_MS);
  return sound;
}
