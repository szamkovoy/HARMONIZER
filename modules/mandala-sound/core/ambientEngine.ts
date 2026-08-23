import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioMetadata,
} from "expo-audio";

import { AMBIENT_SOUND_ASSETS } from "@/modules/mandala-sound/core/ambientAssets";
import type { NatureSoundBedId } from "@/modules/mandala-sound/core/soundBed";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

const DEFAULT_TARGET_VOLUME = 0.55;
const FADE_STEPS = 16;
const FADE_SLEEP_STEP = 16;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyBackgroundAudioMode(staysActiveInBackground: boolean): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: staysActiveInBackground,
    // doNotMix for background practices (exclusive focus + lock screen);
    // duckOthers for foreground practices so the bed is audible without
    // fully stopping other audio.
    interruptionMode: staysActiveInBackground ? "doNotMix" : "duckOthers",
  });
}

function releasePlayer(player: AudioPlayer | null): void {
  if (!player) return;
  try {
    player.pause();
  } catch {
    /* best effort */
  }
  try {
    player.remove();
  } catch {
    /* best effort */
  }
}

/**
 * Single-buffer ambient bed with native looping. The asset is pre-baked with
 * seamless loop points (see build-ambient-loops.mjs), so `player.loop = true`
 * gives continuous playback without a runtime A/B handoff. The previous
 * dual-buffer handoff read `duration` before the player loaded (stayed 0),
 * so the handoff never fired and the buffer stopped after one loop → dropout
 * after ~15s. Native looping removes that failure mode entirely.
 *
 * On Android the buffer is bound to lock-screen controls so a media
 * notification keeps the foreground service alive for sustained background
 * playback (without it Android stops the audio after ~3 minutes in Doze).
 */
export class AmbientLoopEngine {
  private readonly diagnosticId = Math.random().toString(36).slice(2, 8);
  private active: AudioPlayer | null = null;
  private asset: number | null = null;
  private started = false;
  private volume = 0;
  private targetVolume = DEFAULT_TARGET_VOLUME;
  private fadeToken = 0;
  private lockScreenBound = false;
  private lockScreenMetadata: AudioMetadata | undefined;
  private statusSubscription: { remove: () => void } | null = null;
  private onPlaybackStateChange: ((playing: boolean) => void) | undefined;
  private wasPlayingReported = true;

  async start(
    bedId: NatureSoundBedId,
    options?: {
      fadeInMs?: number;
      targetVolume?: number;
      staysActiveInBackground?: boolean;
      lockScreenMetadata?: AudioMetadata;
      onPlaybackStateChange?: (playing: boolean) => void;
    },
  ): Promise<void> {
    if (this.started) return;
    this.started = true;
    const fadeInMs = options?.fadeInMs ?? 600;
    this.targetVolume = Math.max(0, Math.min(1, options?.targetVolume ?? DEFAULT_TARGET_VOLUME));
    const staysActiveInBackground = options?.staysActiveInBackground === true;
    this.lockScreenMetadata = options?.lockScreenMetadata;
    this.onPlaybackStateChange = options?.onPlaybackStateChange;
    this.asset = AMBIENT_SOUND_ASSETS[bedId];
    logRuntimeEvent(
      "ambient_sound:start",
      { id: this.diagnosticId, bedId, fadeInMs, staysActiveInBackground },
      "debug",
    );

    try {
      await applyBackgroundAudioMode(staysActiveInBackground);

      this.active = this.createBuffer(this.asset);

      this.volume = 0;
      this.active.volume = 0;
      this.active.play();
      this.attachStatusListener(this.active);

      if (staysActiveInBackground && this.lockScreenMetadata) {
        this.bindLockScreen(this.active);
      }

      await this.fadeActiveTo(this.targetVolume, fadeInMs);
    } catch (error) {
      this.started = false;
      await this.teardownBuffer();
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

  /**
   * Re-acquire audio focus and resume the ambient buffer after an OS
   * interruption (see ExpoMandalaSoundEngine.resume). Safe when not
   * interrupted — `play()` on an already-playing player is a no-op.
   */
  resume(): void {
    if (!this.started) return;
    try {
      this.active?.play();
    } catch {
      /* best effort */
    }
  }

  async stop(options?: { fadeOutMs?: number }): Promise<void> {
    const fadeOutMs = options?.fadeOutMs ?? 800;
    const wasStarted = this.started;
    if (!wasStarted && !this.active) return;
    this.started = false;
    if (this.statusSubscription) {
      this.statusSubscription.remove();
      this.statusSubscription = null;
    }
    if (this.lockScreenBound && this.active) {
      try {
        this.active.clearLockScreenControls();
      } catch {
        /* best effort */
      }
      this.lockScreenBound = false;
    }
    try {
      if (this.active) {
        await this.fadeActiveTo(0, fadeOutMs);
      }
    } finally {
      await this.teardownBuffer();
      this.volume = 0;
      logRuntimeEvent(
        "ambient_sound:stop",
        { id: this.diagnosticId, wasStarted, fadeOutMs },
        "debug",
      );
    }
  }

  private createBuffer(asset: number): AudioPlayer {
    const player = createAudioPlayer(asset, { updateInterval: 500 });
    // Native looping: the pre-baked seamless asset loops forever. No runtime
    // A/B handoff (the previous handoff dropped audio when duration read 0).
    player.loop = true;
    // Keep silent until fade-in.
    player.volume = 0;
    return player;
  }

  private attachStatusListener(player: AudioPlayer): void {
    if (this.statusSubscription) {
      this.statusSubscription.remove();
    }
    this.statusSubscription = player.addListener("playbackStatusUpdate", (status) => {
      if (!this.started || !status.isLoaded) return;
      // Forward interruption (playing=false while started) / resume (true).
      const playing = status.playing;
      if (playing !== this.wasPlayingReported) {
        this.wasPlayingReported = playing;
        this.onPlaybackStateChange?.(playing);
      }
    });
  }

  private bindLockScreen(player: AudioPlayer): void {
    try {
      player.setActiveForLockScreen(true, this.lockScreenMetadata, {
        showSeekBackward: false,
        showSeekForward: false,
      });
      this.lockScreenBound = true;
    } catch (error) {
      logRuntimeEvent(
        "ambient_sound:lock_screen_bind_failed",
        { id: this.diagnosticId, message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
    }
  }

  private async teardownBuffer(): Promise<void> {
    const a = this.active;
    this.active = null;
    releasePlayer(a);
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
        sound.volume = to;
      } catch {
        /* ignore */
      }
      return;
    }

    const steps = Math.max(4, FADE_STEPS);
    const stepMs = Math.max(FADE_SLEEP_STEP, durationMs / steps);
    for (let i = 1; i <= steps; i += 1) {
      if (token !== this.fadeToken || this.active !== sound) return;
      const t = i / steps;
      const next = from + (to - from) * t;
      this.volume = next;
      try {
        sound.volume = next;
      } catch {
        /* ignore transient */
      }
      if (i < steps) await sleep(stepMs);
    }
  }
}
