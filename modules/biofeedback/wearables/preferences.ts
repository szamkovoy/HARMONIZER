import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";

import type {
  BreathSensorMode,
  WearableCapabilityTier,
  WearableDeviceProvider,
} from "@/modules/biofeedback/wearables/types";

const STORAGE_KEY = "harmonizer.wearable.preferences.v1";

type StoredPreferences = {
  preferredSensorMode: BreathSensorMode;
  autoReconnect: boolean;
  lastDeviceId: string | null;
  lastDeviceName: string | null;
  lastProvider: WearableDeviceProvider | null;
  lastCapabilityTier: WearableCapabilityTier | null;
};

const DEFAULT_PREFERENCES: StoredPreferences = {
  preferredSensorMode: "fingerCamera",
  autoReconnect: true,
  lastDeviceId: null,
  lastDeviceName: null,
  lastProvider: null,
  lastCapabilityTier: null,
};

let currentPreferences: StoredPreferences = DEFAULT_PREFERENCES;
let hydrateStarted = false;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function parseStoredPreferences(raw: string | null): StoredPreferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    return {
      preferredSensorMode:
        parsed.preferredSensorMode === "ble" || parsed.preferredSensorMode === "none"
          ? parsed.preferredSensorMode
          : "fingerCamera",
      autoReconnect: parsed.autoReconnect !== false,
      lastDeviceId: typeof parsed.lastDeviceId === "string" ? parsed.lastDeviceId : null,
      lastDeviceName: typeof parsed.lastDeviceName === "string" ? parsed.lastDeviceName : null,
      lastProvider:
        parsed.lastProvider === "polar" ||
        parsed.lastProvider === "magene" ||
        parsed.lastProvider === "coospo" ||
        parsed.lastProvider === "genericHrs" ||
        parsed.lastProvider === "unknown"
          ? parsed.lastProvider
          : null,
      lastCapabilityTier:
        parsed.lastCapabilityTier === "fullMetrics" ||
        parsed.lastCapabilityTier === "guidedOnly" ||
        parsed.lastCapabilityTier === "unsupported" ||
        parsed.lastCapabilityTier === "unknown"
          ? parsed.lastCapabilityTier
          : null,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

async function readStoredPreferences(): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  }
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeStoredPreferences(value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

export async function hydrateWearablePreferences(): Promise<void> {
  if (hydrateStarted) return;
  hydrateStarted = true;
  try {
    currentPreferences = parseStoredPreferences(await readStoredPreferences());
  } finally {
    emitChange();
  }
}

export function subscribeWearablePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWearablePreferences(): StoredPreferences {
  void hydrateWearablePreferences();
  return currentPreferences;
}

export async function updateWearablePreferences(
  patch: Partial<StoredPreferences>,
): Promise<StoredPreferences> {
  currentPreferences = {
    ...currentPreferences,
    ...patch,
  };
  await writeStoredPreferences(JSON.stringify(currentPreferences));
  emitChange();
  return currentPreferences;
}

export function useWearablePreferences(): StoredPreferences {
  useEffect(() => {
    void hydrateWearablePreferences();
  }, []);
  return useSyncExternalStore(
    subscribeWearablePreferences,
    () => currentPreferences,
    () => currentPreferences,
  );
}
