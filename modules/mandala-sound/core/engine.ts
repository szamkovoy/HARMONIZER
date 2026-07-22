import { Audio } from "expo-av";

import { MANDALA_SOUND_ASSETS } from "@/modules/mandala-sound/core/assets";
import { binauralCrossfadeGains } from "@/modules/mandala-sound/core/binaural";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";
import type {
  MandalaSoundAssetPreset,
  MandalaSoundEngineControls,
  MandalaSoundSyncFrame,
} from "@/modules/mandala-sound/core/types";

type SoundHandle = InstanceType<typeof Audio.Sound>;

type BinauralHandle = { sound: SoundHandle; beatHz: number };

const MIN_VOLUME_DELTA = 0.008;

function chakraIndex(chakra: number): number {
  return Math.max(0, Math.min(6, Math.round(chakra) - 1));
}

async function unload(sound: SoundHandle | null): Promise<void> {
  if (!sound) return;
  try {
    await sound.stopAsync();
  } catch {
    // Best effort: the sound can already be stopped/unloaded by native teardown.
  }
  try {
    await sound.unloadAsync();
  } catch {
    // Best effort cleanup.
  }
}

export class ExpoMandalaSoundEngine implements MandalaSoundEngineControls {
  private readonly diagnosticId = Math.random().toString(36).slice(2, 8);
  private drone: SoundHandle | null = null;
  private textureA: SoundHandle | null = null;
  private textureB: SoundHandle | null = null;
  private binaural: BinauralHandle[] = [];
  private lastDroneVolume = 0;
  private lastTextureAVolume = 0;
  private lastTextureBVolume = 0;
  private lastBinauralVolumes: number[] = [];
  private started = false;
  private updateCount = 0;
  private updateInFlight = false;
  private skippedUpdates = 0;

  constructor(private readonly assets: MandalaSoundAssetPreset = MANDALA_SOUND_ASSETS) {}

  async start(chakra: number): Promise<void> {
    if (this.started) return;
    this.started = true;
    const startedAt = Date.now();
    logRuntimeEvent("mandala_sound:start", { id: this.diagnosticId, chakra }, "debug");

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        // false: Android system BLE "connection request" banners (and similar) briefly
        // duck audio when true — heard as a short scratch/glitch during breath sound.
        shouldDuckAndroid: false,
        staysActiveInBackground: false,
      });

      const selectedDrone = this.assets.drones[chakraIndex(chakra)] ?? this.assets.drones[0];
      const textureOffset = chakraIndex(chakra) % Math.max(1, this.assets.textures.length);
      const textureA = this.assets.textures[textureOffset];
      const textureB = this.assets.textures[(textureOffset + 1) % Math.max(1, this.assets.textures.length)];

      if (selectedDrone) {
        const { sound } = await Audio.Sound.createAsync(selectedDrone, {
          isLooping: true,
          volume: 0,
          shouldPlay: true,
        });
        this.drone = sound;
      }

      if (textureA) {
        const { sound } = await Audio.Sound.createAsync(textureA, {
          isLooping: true,
          volume: 0,
          shouldPlay: true,
        });
        this.textureA = sound;
      }

      if (textureB && textureB !== textureA) {
        const { sound } = await Audio.Sound.createAsync(textureB, {
          isLooping: true,
          volume: 0,
          shouldPlay: true,
        });
        this.textureB = sound;
      }

      await Promise.all(
        this.assets.binaural.map(async (loop) => {
          const { sound } = await Audio.Sound.createAsync(loop.asset, {
            isLooping: true,
            volume: 0,
            shouldPlay: true,
          });
          this.binaural.push({ sound, beatHz: loop.beatHz });
        }),
      );
      this.lastBinauralVolumes = new Array(this.binaural.length).fill(0);
      logRuntimeEvent("mandala_sound:start_ready", {
        id: this.diagnosticId,
        durationMs: Date.now() - startedAt,
        binauralLoops: this.binaural.length,
        hasDrone: Boolean(this.drone),
        hasTextureA: Boolean(this.textureA),
        hasTextureB: Boolean(this.textureB),
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

      await Promise.all([
        this.setLoopVolume("drone", frame.droneGain),
        this.setLoopVolume("textureA", frame.textureGain * frame.textureBrightness),
        this.setLoopVolume("textureB", frame.textureGain * (1 - frame.textureBrightness) * 0.74),
        ...this.binaural.map((entry, index) =>
          this.setBinauralVolume(index, binauralGains[index]! * frame.binauralGain),
        ),
      ]);

      if (frame.gongTrigger) {
        void this.playOneShot(this.assets.gongs[frame.gongTrigger], 0.11);
      }
    } finally {
      this.updateInFlight = false;
    }
  }

  async stop(): Promise<void> {
    const wasStarted = this.started;
    const startedAt = Date.now();
    this.started = false;
    await Promise.all([
      unload(this.drone),
      unload(this.textureA),
      unload(this.textureB),
      ...this.binaural.map((entry) => unload(entry.sound)),
    ]);
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
      durationMs: Date.now() - startedAt,
    }, "debug");
  }

  private async setLoopVolume(
    layer: "drone" | "textureA" | "textureB",
    volume: number,
  ): Promise<void> {
    const safeVolume = Math.max(0, Math.min(0.22, volume));
    const sound = layer === "drone" ? this.drone : layer === "textureA" ? this.textureA : this.textureB;
    if (!sound) return;

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
      await sound.setVolumeAsync(safeVolume);
    } catch {
      // Keep the practice running even if native audio drops a transient command.
    }
  }

  private async setBinauralVolume(index: number, volume: number): Promise<void> {
    const entry = this.binaural[index];
    if (!entry) return;
    const safeVolume = Math.max(0, Math.min(0.075, volume));
    const previous = this.lastBinauralVolumes[index] ?? 0;
    if (Math.abs(previous - safeVolume) < MIN_VOLUME_DELTA) return;
    this.lastBinauralVolumes[index] = safeVolume;

    try {
      await entry.sound.setVolumeAsync(safeVolume);
    } catch {
      // A missed binaural volume update is non-fatal; the next tick will correct it.
    }
  }

  private async playOneShot(asset: number, volume: number): Promise<void> {
    try {
      const { sound } = await Audio.Sound.createAsync(asset, {
        isLooping: false,
        volume,
        shouldPlay: true,
      });
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          void unload(sound);
        }
      });
    } catch {
      // One-shot failures should never interrupt breathing or meditation.
    }
  }
}
