import { Audio } from "expo-av";

import { MANDALA_SOUND_ASSETS } from "@/modules/mandala-sound/core/assets";
import type {
  MandalaSoundAssetPreset,
  MandalaSoundEngineControls,
  MandalaSoundSyncFrame,
} from "@/modules/mandala-sound/core/types";

type SoundHandle = InstanceType<typeof Audio.Sound>;

const EVENT_COOLDOWN_MS = 42_000;
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
  private drone: SoundHandle | null = null;
  private textureA: SoundHandle | null = null;
  private textureB: SoundHandle | null = null;
  private lastDroneVolume = 0;
  private lastTextureAVolume = 0;
  private lastTextureBVolume = 0;
  private lastEventAtMs = 0;
  private started = false;

  constructor(private readonly assets: MandalaSoundAssetPreset = MANDALA_SOUND_ASSETS) {}

  async start(chakra: number): Promise<void> {
    if (this.started) return;
    this.started = true;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
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
  }

  async update(frame: MandalaSoundSyncFrame): Promise<void> {
    if (!this.started) return;

    await Promise.all([
      this.setLoopVolume("drone", frame.droneGain),
      this.setLoopVolume("textureA", frame.textureGain * frame.textureBrightness),
      this.setLoopVolume("textureB", frame.textureGain * (1 - frame.textureBrightness) * 0.74),
    ]);

    if (frame.gongTrigger) {
      void this.playOneShot(this.assets.gongs[frame.gongTrigger], 0.11);
    }

    if (
      this.assets.events.length > 0 &&
      frame.nowMs - this.lastEventAtMs > EVENT_COOLDOWN_MS &&
      Math.random() < 0.0025
    ) {
      this.lastEventAtMs = frame.nowMs;
      const event = this.assets.events[Math.floor(Math.random() * this.assets.events.length)];
      if (event) {
        void this.playOneShot(event, 0.075);
      }
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    await Promise.all([
      unload(this.drone),
      unload(this.textureA),
      unload(this.textureB),
    ]);
    this.drone = null;
    this.textureA = null;
    this.textureB = null;
    this.lastDroneVolume = 0;
    this.lastTextureAVolume = 0;
    this.lastTextureBVolume = 0;
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
