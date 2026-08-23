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
/** Runtime A/B handoff — masks AAC encoder padding + any residual seam. */
const LOOP_CROSSFADE_MS = 4000;
const STATUS_POLL_MS = 200;
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
 * Dual-buffer ambient bed: near the end of one buffer, the next starts at 0
 * and volumes crossfade (~4s). Loop seams are also pre-baked in the asset
 * (see build-ambient-loops.mjs); runtime handoff covers AAC loop gaps.
 *
 * On Android the active buffer is bound to lock-screen controls so a media
 * notification keeps the foreground service alive for sustained background
 * playback (without it Android stops the audio after ~3 minutes in Doze).
 */
export class AmbientLoopEngine {
  private readonly diagnosticId = Math.random().toString(36).slice(2, 8);
  private active: AudioPlayer | null = null;
  private idle: AudioPlayer | null = null;
  private asset: number | null = null;
  private started = false;
  private volume = 0;
  private targetVolume = DEFAULT_TARGET_VOLUME;
  private fadeToken = 0;
  private handoffToken = 0;
  private handoffInFlight = false;
  private durationMs = 0;
  private lockScreenBound = false;
  private lockScreenMetadata: AudioMetadata | undefined;
  private statusSubscription: { remove: () => void } | null = null;
  private interruptionSubscription: { remove: () => void } | null = null;
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
      { id: this.diagnosticId, bedId, fadeInMs, staysActiveInBackground, loopCrossfadeMs: LOOP_CROSSFADE_MS },
      "debug",
    );

    try {
      await applyBackgroundAudioMode(staysActiveInBackground);

      this.active = await this.createBuffer(this.asset);
      this.idle = await this.createBuffer(this.asset);

      const status = this.active.currentStatus;
      this.durationMs = status.isLoaded && status.duration ? status.duration * 1000 : 0;
      if (this.durationMs > 0 && this.durationMs < LOOP_CROSSFADE_MS + 2000) {
        throw new Error(`Ambient loop too short for crossfade: ${this.durationMs}ms`);
      }

      this.volume = 0;
      this.active.volume = 0;
      this.active.play();
      this.attachHandoffWatcher(this.active);

      if (staysActiveInBackground && this.lockScreenMetadata) {
        this.bindLockScreen(this.active);
      }

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
    const fadeOutMs = options?.fadeOutMs ?? 800;
    const wasStarted = this.started;
    if (!wasStarted && !this.active && !this.idle) return;
    this.started = false;
    this.handoffToken += 1;
    this.handoffInFlight = false;
    if (this.statusSubscription) {
      this.statusSubscription.remove();
      this.statusSubscription = null;
    }
    if (this.interruptionSubscription) {
      this.interruptionSubscription.remove();
      this.interruptionSubscription = null;
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
      await this.teardownBuffers();
      this.volume = 0;
      logRuntimeEvent(
        "ambient_sound:stop",
        { id: this.diagnosticId, wasStarted, fadeOutMs },
        "debug",
      );
    }
  }

  private async createBuffer(asset: number): Promise<AudioPlayer> {
    const player = createAudioPlayer(asset, { updateInterval: STATUS_POLL_MS });
    // Default player volume is 1.0; keep buffers silent until they're faded in.
    player.volume = 0;
    return player;
  }

  private attachHandoffWatcher(player: AudioPlayer): void {
    if (this.statusSubscription) {
      this.statusSubscription.remove();
    }
    this.statusSubscription = player.addListener("playbackStatusUpdate", (status) => {
      if (!this.started || !status.isLoaded || this.handoffInFlight) return;
      const durationMs = (status.duration ?? 0) * 1000 || this.durationMs;
      const positionMs = (status.currentTime ?? 0) * 1000;
      if (durationMs <= 0) return;
      if (positionMs >= durationMs - LOOP_CROSSFADE_MS) {
        void this.handoff();
      }
    });
    // Re-bind interruption reporting to the new lead buffer.
    if (this.interruptionSubscription) {
      this.interruptionSubscription.remove();
    }
    if (this.onPlaybackStateChange) {
      this.wasPlayingReported = true;
      this.interruptionSubscription = player.addListener("playbackStatusUpdate", (status) => {
        if (!this.started || !status.isLoaded || this.handoffInFlight) return;
        const playing = status.playing;
        if (playing !== this.wasPlayingReported) {
          this.wasPlayingReported = playing;
          this.onPlaybackStateChange!(playing);
        }
      });
    }
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

  private async handoff(): Promise<void> {
    if (!this.started || this.handoffInFlight) return;
    const from = this.active;
    const to = this.idle;
    if (!from || !to || !this.asset) return;
    this.handoffInFlight = true;
    const token = ++this.handoffToken;
    const peak = this.targetVolume;

    try {
      await to.seekTo(0);
      to.volume = 0;
      to.play();

      const steps = Math.max(8, FADE_STEPS);
      const stepMs = LOOP_CROSSFADE_MS / steps;
      for (let i = 1; i <= steps; i += 1) {
        if (token !== this.handoffToken || !this.started) return;
        const t = i / steps;
        const fromVol = peak * (1 - t);
        const toVol = peak * t;
        this.volume = toVol;
        from.volume = fromVol;
        to.volume = toVol;
        if (i < steps) await sleep(stepMs);
      }

      if (token !== this.handoffToken || !this.started) return;

      try {
        from.pause();
      } catch {
        /* ignore */
      }
      try {
        from.seekTo(0);
        from.volume = 0;
      } catch {
        /* recreate below if needed */
      }

      this.active = to;
      this.idle = from;
      this.attachHandoffWatcher(to);
      this.volume = peak;

      // Rebind lock-screen controls to the new active buffer so the
      // foreground-service notification tracks the actually-playing buffer.
      if (this.lockScreenMetadata) {
        try {
          from.clearLockScreenControls();
        } catch {
          /* best effort */
        }
        this.bindLockScreen(to);
      }
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
    releasePlayer(a);
    releasePlayer(b);
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
