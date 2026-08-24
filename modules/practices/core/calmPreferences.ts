import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";

import {
  CALM_DURATION_MINUTES,
  isCalmDurationMinutes,
  type CalmDurationMinutes,
} from "@/modules/practices/core/calmPractice";
import {
  CALM_DEFAULT_SOUND_BED,
  parseCalmSoundBedId,
  type SoundBedId,
} from "@/modules/mandala-sound/core/soundBed";

const STORAGE_KEY = "harmonizer.calm.preferences.v1";

type CalmPreferences = {
  durationMin: CalmDurationMinutes;
  soundBed: SoundBedId;
};

const DEFAULT_PREFERENCES: CalmPreferences = {
  durationMin: 30,
  // Binaural (neuro-sync) bed is no longer offered for Calm — default to a
  // nature bed. A previously-stored `neuro-sync` choice is migrated to this
  // default by `parseCalmSoundBedId` (which rejects neuro-sync).
  soundBed: CALM_DEFAULT_SOUND_BED,
};

let current: CalmPreferences = DEFAULT_PREFERENCES;
let hydrateStarted = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function parse(raw: string | null): CalmPreferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<CalmPreferences>;
    const durationMin = typeof parsed.durationMin === "number" ? parsed.durationMin : DEFAULT_PREFERENCES.durationMin;
    return {
      durationMin: isCalmDurationMinutes(durationMin) ? durationMin : DEFAULT_PREFERENCES.durationMin,
      soundBed: parseCalmSoundBedId(parsed.soundBed),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

async function hydrate() {
  if (hydrateStarted) return;
  hydrateStarted = true;
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    current = parse(raw);
    emit();
  } catch {
    current = DEFAULT_PREFERENCES;
  }
}

void hydrate();

export function getCalmPreferences(): CalmPreferences {
  return current;
}

export async function updateCalmPreferences(patch: Partial<CalmPreferences>): Promise<void> {
  const next: CalmPreferences = {
    durationMin:
      typeof patch.durationMin === "number" && isCalmDurationMinutes(patch.durationMin)
        ? patch.durationMin
        : current.durationMin,
    soundBed: patch.soundBed != null ? parseCalmSoundBedId(patch.soundBed) : current.soundBed,
  };
  current = next;
  emit();
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* best effort */
  }
}

export function useCalmPreferences(): CalmPreferences {
  useEffect(() => {
    void hydrate();
  }, []);
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => current,
    () => DEFAULT_PREFERENCES,
  );
}

export { CALM_DURATION_MINUTES };
