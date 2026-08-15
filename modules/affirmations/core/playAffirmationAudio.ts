import { Audio, type AVPlaybackStatus, type AVPlaybackStatusToSet } from "expo-av";

import { resolveAffirmationPlaybackUri } from "@/modules/affirmations/core/affirmationAudioCache";
import type { AudioEdgeTrim } from "@/modules/affirmations/core/recordingSpeechTracker";

/** Short in so speech is heard quickly; longer out matches ~1s edge pad. */
const FADE_IN_MS = 280;
const FADE_OUT_MS = 1_000;
const FADE_STEPS = 8;

type ReadyClip = {
  audioPath: string;
  uri: string;
  sound: Audio.Sound;
};

let ready: ReadyClip | null = null;
let warmInFlight: Promise<ReadyClip | null> | null = null;

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

async function ensurePlaybackAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });
}

async function disposeReady() {
  const clip = ready;
  ready = null;
  if (!clip) return;
  try {
    await clip.sound.stopAsync();
  } catch {
    /* ignore */
  }
  try {
    await clip.sound.unloadAsync();
  } catch {
    /* ignore */
  }
}

/**
 * Download + load Sound ahead of the Listen / breath cue so play is near-instant.
 */
export async function warmAffirmationPlayback(
  audioPath: string | null | undefined,
  remoteUri: string | null | undefined,
): Promise<void> {
  if (!audioPath || !remoteUri) {
    await disposeReady();
    return;
  }
  if (ready?.audioPath === audioPath) return;
  if (warmInFlight) {
    await warmInFlight;
    if (ready?.audioPath === audioPath) return;
  }

  warmInFlight = (async (): Promise<ReadyClip | null> => {
    try {
      const uri = await resolveAffirmationPlaybackUri(audioPath, remoteUri);
      await ensurePlaybackAudioMode();
      if (ready?.audioPath === audioPath && ready.uri === uri) return ready;
      await disposeReady();
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false, volume: 0 } satisfies AVPlaybackStatusToSet,
      );
      const clip: ReadyClip = { audioPath, uri, sound };
      ready = clip;
      return clip;
    } catch {
      await disposeReady();
      return null;
    } finally {
      warmInFlight = null;
    }
  })();

  await warmInFlight;
}

/**
 * Play affirmation voice (manage preview + breath overlay).
 * Pass `audioPath` when the URI is a remote signed URL so we can use the disk cache
 * and any pre-warmed Sound from `warmAffirmationPlayback`.
 */
export async function playAffirmationAudio(
  uri: string,
  options?: {
    audioPath?: string | null;
    onFinished?: () => void;
    trim?: AudioEdgeTrim | null;
  },
): Promise<Audio.Sound> {
  const audioPath = options?.audioPath ?? null;
  const trim = options?.trim ?? null;
  const trimStart = trim && trim.startMs > 0 ? trim.startMs : 0;
  const trimEnd = trim && trim.endMs > trimStart ? trim.endMs : null;

  let sound: Audio.Sound;
  let fromWarm = false;

  if (audioPath && ready?.audioPath === audioPath) {
    sound = ready.sound;
    fromWarm = true;
  } else if (audioPath) {
    await warmAffirmationPlayback(audioPath, uri);
    if (ready?.audioPath === audioPath) {
      sound = ready.sound;
      fromWarm = true;
    } else {
      await ensurePlaybackAudioMode();
      const localUri = await resolveAffirmationPlaybackUri(audioPath, uri);
      const created = await Audio.Sound.createAsync(
        { uri: localUri },
        { shouldPlay: false, volume: 0 } satisfies AVPlaybackStatusToSet,
      );
      sound = created.sound;
    }
  } else {
    await ensurePlaybackAudioMode();
    const created = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: false, volume: 0 } satisfies AVPlaybackStatusToSet,
    );
    sound = created.sound;
  }

  let fadingOut = false;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    options?.onFinished?.();
    if (fromWarm && ready?.sound === sound) {
      // Keep clip loaded for the next Listen / finale cue.
      void (async () => {
        try {
          await sound.stopAsync();
        } catch {
          /* ignore */
        }
        try {
          await sound.setVolumeAsync(0);
          await sound.setPositionAsync(trimStart > 0 ? trimStart : 0);
        } catch {
          /* ignore */
        }
      })();
      return;
    }
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
      effectiveEnd - trimStart > FADE_OUT_MS * 2 &&
      pos >= effectiveEnd - FADE_OUT_MS
    ) {
      fadingOut = true;
      void fadeVolume(sound, 1, 0, FADE_OUT_MS);
    }
  });

  try {
    await sound.setVolumeAsync(0);
  } catch {
    /* ignore */
  }
  if (trimStart > 0) {
    try {
      await sound.setPositionAsync(trimStart);
    } catch {
      /* play from 0 if seek fails */
    }
  } else {
    try {
      await sound.setPositionAsync(0);
    } catch {
      /* ignore */
    }
  }
  await sound.playAsync();
  void fadeVolume(sound, 0, 1, FADE_IN_MS);
  return sound;
}

/** Drop warmed Sound (e.g. after voice re-upload). Disk cache stays until path changes. */
export async function invalidateAffirmationPlayback(audioPath?: string | null): Promise<void> {
  if (audioPath && ready && ready.audioPath !== audioPath) return;
  await disposeReady();
}
