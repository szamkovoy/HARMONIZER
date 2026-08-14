import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { InteractionManager, Platform } from "react-native";

import {
  communicatorRecordingFallbackOptions,
  whisperRecordingOptions,
} from "@/modules/communicator/core/whisperRecording";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Start a Whisper-oriented recording with the same iOS-hardening path as Communicator:
 * audio mode + settle delay, metering/no-metering/fallback presets, short retries.
 * Affirmation wizard previously called `createAsync` once right after the permission
 * sheet — that often throws «Recording not allowed» on first grant.
 */
export async function startWhisperRecording(options?: {
  isMeteringEnabled?: boolean;
}): Promise<Audio.Recording> {
  const wantMetering = options?.isMeteringEnabled !== false;

  const applyRecordingAudioMode = async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false,
    });
  };

  await Audio.setIsEnabledAsync(true);
  await applyRecordingAudioMode();
  await sleep(Platform.OS === "ios" ? 180 : 70);

  const variants = [
    whisperRecordingOptions({ isMeteringEnabled: wantMetering }),
    whisperRecordingOptions({ isMeteringEnabled: false }),
    communicatorRecordingFallbackOptions(),
  ] as const;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (let vi = 0; vi < variants.length; vi += 1) {
      try {
        if (Platform.OS === "ios" && (attempt > 0 || vi > 0)) {
          await new Promise<void>((resolve) => {
            InteractionManager.runAfterInteractions(() => resolve());
          });
        }
        const { recording } = await Audio.Recording.createAsync(variants[vi]);
        return recording;
      } catch (e) {
        lastErr = e;
        try {
          await applyRecordingAudioMode();
        } catch {
          /* ignore */
        }
        await sleep(Platform.OS === "ios" ? 110 : 70);
      }
    }
    if (attempt < 2) await sleep(attempt === 0 ? 200 : 360);
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Recording failed"));
}

export async function resetPlaybackAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
  } catch {
    /* ignore */
  }
}
