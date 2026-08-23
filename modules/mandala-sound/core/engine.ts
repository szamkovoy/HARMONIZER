import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioMetadata } from "expo-audio";

import { MANDALA_SOUND_ASSETS } from "@/modules/mandala-sound/core/assets";
import { binauralCrossfadeGains } from "@/modules/mandala-sound/core/binaural";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";
import type {
  MandalaSoundAssetPreset,
  MandalaSoundEngineControls,
  MandalaSoundSyncFrame,
} from "@/modules/mandala-sound/core/types";

type BinauralHandle = { player: AudioPlayer; beatHz: number };

const MIN_VOLUME_DELTA = 0.008;
const FADE_SLEEP_STEP = 16;

function chakraIndex(chakra: number): number {
  return Math.max(0, Math.min(6, Math.round(chakra) - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a `require()`'d image asset to a local `file://` URI for lock-screen
 * artwork. expo-audio's `AudioMetadata.artworkUrl` expects a URL string; a
 * bundled asset is turned into a downloadable local URI via expo-asset.
 */
export async function resolveLocalArtworkUri(imageRequire: number): Promise<string | undefined> {
  try {
    // Lazy import — expo-asset is a transitive Expo dependency.
    const { Asset } = await import("expo-asset");
    const asset = Asset.fromModule(imageRequire);
    await asset.downloadAsync();
    return asset.localUri ?? undefined;
  } catch {
    return undefined;
  }
}

export class ExpoMandalaSoundEngine implements MandalaSoundEngineControls {
  private readonly diagnosticId = Math.random().toString(36).slice(2, 8);
  private drone: AudioPlayer | null = null;
  private textureA: AudioPlayer | null = null;
  private textureB: AudioPlayer | null = null;
  private binaural: BinauralHandle[] = [];
  private lastDroneVolume = 0;
  private lastTextureAVolume = 0;
  private lastTextureBVolume = 0;
  private lastBinauralVolumes: number[] = [];
  private started = false;
  private updateCount = 0;
  private updateInFlight = false;
  private skippedUpdates = 0;
  private lockScreenBound = false;

  constructor(private readonly assets: MandalaSoundAssetPreset = MANDALA_SOUND_ASSETS) {}

  async start(
    chakra: number,
    options?: {
      staysActiveInBackground?: boolean;
      lockScreenMetadata?: AudioMetadata;
      onPlaybackStateChange?: (playing: boolean) => void;
    },
  ): Promise<void> {
    if (this.started) return;
    this.started = true;
    const startedAt = Date.now();
    const staysActiveInBackground = options?.staysActiveInBackground === true;
    logRuntimeEvent("mandala_sound:start", { id: this.diagnosticId, chakra, staysActiveInBackground }, "debug");

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: staysActiveInBackground,
        // doNotMix (exclusive) for background practices — required for
        // setActiveForLockScreen and so a meditation is the only audio. For
        // foreground practices (breath/Flash, screen kept on) use duckOthers so
        // the practice bed stays audible without fully stopping other audio.
        interruptionMode: staysActiveInBackground ? "doNotMix" : "duckOthers",
      });

      const selectedDrone = this.assets.drones[chakraIndex(chakra)] ?? this.assets.drones[0];
      const textureOffset = chakraIndex(chakra) % Math.max(1, this.assets.textures.length);
      const textureA = this.assets.textures[textureOffset];
      const textureB = this.assets.textures[(textureOffset + 1) % Math.max(1, this.assets.textures.length)];

      if (selectedDrone) {
        this.drone = createAudioPlayer(selectedDrone, { updateInterval: 500 });
        this.drone.loop = true;
        this.drone.volume = 0;
        this.drone.play();
      }

      if (textureA) {
        this.textureA = createAudioPlayer(textureA, { updateInterval: 500 });
        this.textureA.loop = true;
        this.textureA.volume = 0;
        this.textureA.play();
      }

      if (textureB && textureB !== textureA) {
        this.textureB = createAudioPlayer(textureB, { updateInterval: 500 });
        this.textureB.loop = true;
        this.textureB.volume = 0;
        this.textureB.play();
      }

      await Promise.all(
        this.assets.binaural.map(async (loop) => {
          const player = createAudioPlayer(loop.asset, { updateInterval: 500 });
          player.loop = true;
          player.volume = 0;
          player.play();
          this.binaural.push({ player, beatHz: loop.beatHz });
        }),
      );
      this.lastBinauralVolumes = new Array(this.binaural.length).fill(0);

      // Bind lock-screen controls to the drone (the continuous lead layer).
      if (staysActiveInBackground && options?.lockScreenMetadata && this.drone) {
        try {
          this.drone.setActiveForLockScreen(true, options.lockScreenMetadata, {
            showSeekBackward: false,
            showSeekForward: false,
          });
          this.lockScreenBound = true;
        } catch (error) {
          logRuntimeEvent(
            "mandala_sound:lock_screen_bind_failed",
            { id: this.diagnosticId, message: error instanceof Error ? error.message : String(error) },
            "warn",
          );
        }
      }

      // Forward lead-player play/pause changes (system interruption / resume).
      // We never pause the drone ourselves while `started`, so a `playing=false`
      // status while started signals an external interruption (call, another app).
      if (options?.onPlaybackStateChange && this.drone) {
        let wasPlaying = true;
        this.drone.addListener("playbackStatusUpdate", (status) => {
          if (!this.started || !status.isLoaded) return;
          const playing = status.playing;
          if (playing !== wasPlaying) {
            wasPlaying = playing;
            options.onPlaybackStateChange!(playing);
          }
        });
      }

      logRuntimeEvent("mandala_sound:start_ready", {
        id: this.diagnosticId,
        durationMs: Date.now() - startedAt,
        binauralLoops: this.binaural.length,
        hasDrone: Boolean(this.drone),
        hasTextureA: Boolean(this.textureA),
        hasTextureB: Boolean(this.textureB),
        lockScreenBound: this.lockScreenBound,
      });
    } catch (error) {
      logRuntimeEvent(
        "mandala_sound:start_failed",
        { id: this.diagnosticId, durationMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      await this.stop();
      throw error;
    }
  }

  /**
   * Re-acquire audio focus and resume all players after an OS interruption
   * (call / another app that took focus, or wake from Doze after a full
   * AUDIOFOCUS_LOSS). The native foreground-resume hook in expo-audio only
   * fires for `!staysActiveInBackground`, so background practices must
   * re-request focus from JS when the app returns to the foreground.
   * Safe to call when not interrupted — `play()` on an already-playing
   * ExoPlayer is a no-op.
   */
  resume(): void {
    if (!this.started) return;
    try {
      this.drone?.play();
      this.textureA?.play();
      this.textureB?.play();
      this.binaural.forEach((entry) => entry.player.play());
    } catch {
      /* best effort — next update tick will keep volumes in sync */
    }
  }

  async update(frame: MandalaSoundSyncFrame): Promise<void> {
    if (!this.started) return;
    if (this.updateInFlight) {
      this.skippedUpdates += 1;
      if (this.skippedUpdates % 10 === 0) {
        logRuntimeEvent("mandala_sound:update_skipped", {
          id: this.diagnosticId,
          skippedUpdates: this.skippedUpdates,
        }, "warn");
      }
      return;
    }
    this.updateInFlight = true;
    this.updateCount += 1;
    try {
      if (this.updateCount % 20 === 0) {
        logRuntimeEvent("mandala_sound:update_tick", {
          id: this.diagnosticId,
          updateCount: this.updateCount,
          skippedUpdates: this.skippedUpdates,
          band: frame.band,
          targetHz: Math.round(frame.targetHz * 1000) / 1000,
          droneGain: Math.round(frame.droneGain * 1000) / 1000,
          binauralGain: Math.round(frame.binauralGain * 1000) / 1000,
        }, "debug");
      }

      const binauralGains = binauralCrossfadeGains(
        frame.targetHz,
        this.binaural.map((entry) => entry.beatHz),
      );

      this.setLoopVolume("drone", frame.droneGain);
      this.setLoopVolume("textureA", frame.textureGain * frame.textureBrightness);
      this.setLoopVolume("textureB", frame.textureGain * (1 - frame.textureBrightness) * 0.74);
      this.binaural.forEach((entry, index) =>
        this.setBinauralVolume(index, (binauralGains[index] ?? 0) * frame.binauralGain),
      );

      if (frame.gongTrigger) {
        void this.playOneShot(this.assets.gongs[frame.gongTrigger], 0.11);
      }
    } finally {
      this.updateInFlight = false;
    }
  }

  async stop(options?: { fadeOutMs?: number }): Promise<void> {
    const wasStarted = this.started;
    const startedAt = Date.now();
    const fadeOutMs = options?.fadeOutMs ?? 0;
    this.started = false;
    if (fadeOutMs > 0 && wasStarted) {
      await this.fadeAllToZero(fadeOutMs);
    }
    if (this.lockScreenBound && this.drone) {
      try {
        this.drone.clearLockScreenControls();
      } catch {
        /* best effort */
      }
      this.lockScreenBound = false;
    }
    for (const entry of this.binaural) {
      this.releasePlayer(entry.player);
    }
    this.releasePlayer(this.drone);
    this.releasePlayer(this.textureA);
    this.releasePlayer(this.textureB);
    this.drone = null;
    this.textureA = null;
    this.textureB = null;
    this.binaural = [];
    this.lastDroneVolume = 0;
    this.lastTextureAVolume = 0;
    this.lastTextureBVolume = 0;
    this.lastBinauralVolumes = [];
    this.updateCount = 0;
    this.updateInFlight = false;
    this.skippedUpdates = 0;
    logRuntimeEvent("mandala_sound:stop", {
      id: this.diagnosticId,
      wasStarted,
      fadeOutMs,
      durationMs: Date.now() - startedAt,
    }, "debug");
  }

  private releasePlayer(player: AudioPlayer | null): void {
    if (!player) return;
    try {
      player.pause();
    } catch {
      /* best effort */
    }
    try {
      player.remove();
    } catch {
      /* best effort: native teardown may have already released it */
    }
  }

  private async fadeAllToZero(durationMs: number): Promise<void> {
    const steps = 12;
    const stepMs = Math.max(FADE_SLEEP_STEP, durationMs / steps);
    const drone0 = this.lastDroneVolume;
    const textureA0 = this.lastTextureAVolume;
    const textureB0 = this.lastTextureBVolume;
    const binaural0 = this.binaural.map((_, index) => this.lastBinauralVolumes[index] ?? 0);
    for (let i = 1; i <= steps; i += 1) {
      const gain = 1 - i / steps;
      this.setLoopVolume("drone", drone0 * gain);
      this.setLoopVolume("textureA", textureA0 * gain);
      this.setLoopVolume("textureB", textureB0 * gain);
      this.binaural.forEach((_, index) => this.setBinauralVolume(index, (binaural0[index] ?? 0) * gain));
      if (i < steps) {
        await sleep(stepMs);
      }
    }
  }

  private setLoopVolume(layer: "drone" | "textureA" | "textureB", volume: number): void {
    const safeVolume = Math.max(0, Math.min(0.22, volume));
    const player = layer === "drone" ? this.drone : layer === "textureA" ? this.textureA : this.textureB;
    if (!player) return;

    const previous =
      layer === "drone"
        ? this.lastDroneVolume
        : layer === "textureA"
          ? this.lastTextureAVolume
          : this.lastTextureBVolume;
    if (Math.abs(previous - safeVolume) < MIN_VOLUME_DELTA) return;

    if (layer === "drone") this.lastDroneVolume = safeVolume;
    else if (layer === "textureA") this.lastTextureAVolume = safeVolume;
    else this.lastTextureBVolume = safeVolume;

    try {
      player.volume = safeVolume;
    } catch {
      // Keep the practice running even if native audio drops a transient command.
    }
  }

  private setBinauralVolume(index: number, volume: number): void {
    const entry = this.binaural[index];
    if (!entry) return;
    const safeVolume = Math.max(0, Math.min(0.075, volume));
    const previous = this.lastBinauralVolumes[index] ?? 0;
    if (Math.abs(previous - safeVolume) < MIN_VOLUME_DELTA) return;
    this.lastBinauralVolumes[index] = safeVolume;

    try {
      entry.player.volume = safeVolume;
    } catch {
      // A missed binaural volume update is non-fatal; the next tick will correct it.
    }
  }

  private playOneShot(asset: number, volume: number): void {
    try {
      const player = createAudioPlayer(asset, { updateInterval: 500 });
      player.loop = false;
      player.volume = volume;
      const subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.isLoaded && status.didJustFinish) {
          subscription.remove();
          this.releasePlayer(player);
        }
      });
      player.play();
    } catch {
      // One-shot failures should never interrupt breathing or meditation.
    }
  }
}
