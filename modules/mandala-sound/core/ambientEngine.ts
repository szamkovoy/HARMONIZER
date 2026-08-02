import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";

import { AMBIENT_SOUND_ASSETS } from "@/modules/mandala-sound/core/ambientAssets";
import type { NatureSoundBedId } from "@/modules/mandala-sound/core/soundBed";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

type SoundHandle = InstanceType<typeof Audio.Sound>;

const DEFAULT_TARGET_VOLUME = 0.55;
const FADE_STEPS = 16;
/** Runtime A/B handoff — masks AAC encoder padding + any residual seam. */
const LOOP_CROSSFADE_MS = 4000;
const STATUS_POLL_MS = 200;

async function unload(sound: SoundHandle | null): Promise<void> {
  if (!sound) return;
  try {
    sound.setOnPlaybackStatusUpdate(null);
  } catch {
    /* ignore */
  }
  try {
    await sound.stopAsync();
  } catch {
    /* best effort */
  }
  try {
    await sound.unloadAsync();
  } catch {
    /* best effort */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyBackgroundAudioMode(staysActiveInBackground: boolean): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  });
}

/**
 * Dual-buffer ambient bed: near the end of one buffer, the next starts at 0
 * and volumes crossfade (~4s). Loop seams are also pre-baked in the asset
 * (see build-ambient-loops.mjs); runtime handoff covers AAC loop gaps.
 */
export class AmbientLoopEngine {
  private readonly diagnosticId = Math.random().toString(36).slice(2, 8);
  private active: SoundHandle | null = null;
  private idle: SoundHandle | null = null;
  private asset: number | null = null;
  private started = false;
  private volume = 0;
  private targetVolume = DEFAULT_TARGET_VOLUME;
  private fadeToken = 0;
  private handoffToken = 0;
  private handoffInFlight = false;
  private durationMs = 0;

  async start(
    bedId: NatureSoundBedId,
    options?: { fadeInMs?: number; targetVolume?: number; staysActiveInBackground?: boolean },
  ): Promise<void> {
    if (this.started) return;
    this.started = true;
    const fadeInMs = options?.fadeInMs ?? 2000;
    this.targetVolume = Math.max(0, Math.min(1, options?.targetVolume ?? DEFAULT_TARGET_VOLUME));
    const staysActiveInBackground = options?.staysActiveInBackground === true;
    this.asset = AMBIENT_SOUND_ASSETS[bedId];
    logRuntimeEvent(
      "ambient_sound:start",
      { id: this.diagnosticId, bedId, fadeInMs, staysActiveInBackground, loopCrossfadeMs: LOOP_CROSSFADE_MS },
      "debug",
    );

    try {
      await applyBackgroundAudioMode(staysActiveInBackground);

      const active = await this.createBuffer(this.asset);
      const idle = await this.createBuffer(this.asset);
      this.active = active;
      this.idle = idle;

      const status = await active.getStatusAsync();
      this.durationMs = status.isLoaded && status.durationMillis ? status.durationMillis : 0;
      if (this.durationMs > 0 && this.durationMs < LOOP_CROSSFADE_MS + 2000) {
        throw new Error(`Ambient loop too short for crossfade: ${this.durationMs}ms`);
      }

      this.volume = 0;
      await active.setVolumeAsync(0);
      await active.playAsync();
      this.attachHandoffWatcher(active);
      await this.fadeActiveTo(this.targetVolume, fadeInMs);
    } catch (error) {
      this.started = false;
      await this.teardownBuffers();
      logRuntimeEvent(
        "ambient_sound:start_failed",
        {
          id: this.diagnosticId,
          bedId,
          message: error instanceof Error ? error.message : String(error),
        },
        "warn",
      );
      throw error;
    }
  }

  async stop(options?: { fadeOutMs?: number }): Promise<void> {
    const fadeOutMs = options?.fadeOutMs ?? 2500;
    const wasStarted = this.started;
    if (!wasStarted && !this.active && !this.idle) return;
    this.started = false;
    this.handoffToken += 1;
    this.handoffInFlight = false;
    try {
      if (this.active) {
        await this.fadeActiveTo(0, fadeOutMs);
      }
    } finally {
      await this.teardownBuffers();
      this.volume = 0;
      logRuntimeEvent(
        "ambient_sound:stop",
        { id: this.diagnosticId, wasStarted, fadeOutMs },
        "debug",
      );
    }
  }

  private async createBuffer(asset: number): Promise<SoundHandle> {
    const { sound } = await Audio.Sound.createAsync(
      asset,
      {
        isLooping: false,
        volume: 0,
        shouldPlay: false,
        progressUpdateIntervalMillis: STATUS_POLL_MS,
      },
      undefined,
      true,
    );
    return sound;
  }

  private attachHandoffWatcher(sound: SoundHandle): void {
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!this.started || !status.isLoaded || this.handoffInFlight) return;
      const durationMs = status.durationMillis ?? this.durationMs;
      const positionMs = status.positionMillis ?? 0;
      if (durationMs <= 0) return;
      if (positionMs >= durationMs - LOOP_CROSSFADE_MS) {
        void this.handoff();
      }
    });
  }

  private async handoff(): Promise<void> {
    if (!this.started || this.handoffInFlight) return;
    const from = this.active;
    const to = this.idle;
    if (!from || !to || !this.asset) return;
    this.handoffInFlight = true;
    const token = ++this.handoffToken;
    const peak = this.targetVolume;

    try {
      await to.setPositionAsync(0);
      await to.setVolumeAsync(0);
      await to.playAsync();

      const steps = Math.max(8, FADE_STEPS);
      const stepMs = LOOP_CROSSFADE_MS / steps;
      for (let i = 1; i <= steps; i += 1) {
        if (token !== this.handoffToken || !this.started) return;
        const t = i / steps;
        const fromVol = peak * (1 - t);
        const toVol = peak * t;
        this.volume = toVol;
        await Promise.all([from.setVolumeAsync(fromVol), to.setVolumeAsync(toVol)]);
        if (i < steps) await sleep(stepMs);
      }

      if (token !== this.handoffToken || !this.started) return;

      try {
        await from.stopAsync();
      } catch {
        /* ignore */
      }
      try {
        await from.setPositionAsync(0);
        await from.setVolumeAsync(0);
      } catch {
        /* recreate below if needed */
      }

      this.active = to;
      this.idle = from;
      this.attachHandoffWatcher(to);
      this.volume = peak;
    } catch (error) {
      logRuntimeEvent(
        "ambient_sound:handoff_failed",
        {
          id: this.diagnosticId,
          message: error instanceof Error ? error.message : String(error),
        },
        "warn",
      );
    } finally {
      if (token === this.handoffToken) {
        this.handoffInFlight = false;
      }
    }
  }

  private async teardownBuffers(): Promise<void> {
    const a = this.active;
    const b = this.idle;
    this.active = null;
    this.idle = null;
    await Promise.all([unload(a), unload(b)]);
  }

  private async fadeActiveTo(target: number, durationMs: number): Promise<void> {
    const sound = this.active;
    if (!sound) return;
    const token = ++this.fadeToken;
    const from = this.volume;
    const to = Math.max(0, Math.min(1, target));
    if (durationMs <= 0 || Math.abs(from - to) < 0.001) {
      this.volume = to;
      try {
        await sound.setVolumeAsync(to);
      } catch {
        /* ignore */
      }
      return;
    }

    const steps = Math.max(4, FADE_STEPS);
    const stepMs = durationMs / steps;
    for (let i = 1; i <= steps; i += 1) {
      if (token !== this.fadeToken || this.active !== sound) return;
      const t = i / steps;
      const next = from + (to - from) * t;
      this.volume = next;
      try {
        await sound.setVolumeAsync(next);
      } catch {
        /* ignore transient */
      }
      if (i < steps) await sleep(stepMs);
    }
  }
}
