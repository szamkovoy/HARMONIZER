import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";

import type { BreathPracticeId } from "@/modules/breath/i18n/coherence";
import {
  defaultTempoKey,
  persistableTempoKey,
} from "@/modules/breath/core/breath-tempo";

const STORAGE_KEY = "harmonizer.breath.tempo.preferences.v1";

const PRACTICE_IDS: readonly BreathPracticeId[] = [
  "coherent",
  "nadi-shodhana",
  "surya-bhedana",
  "chandra-bhedana",
  "square",
  "triangle-up",
  "triangle-down",
];

export type BreathTempoPreferences = Partial<Record<BreathPracticeId, string>>;

let current: BreathTempoPreferences = {};
let hydrateStarted = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function parse(raw: string | null): BreathTempoPreferences {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: BreathTempoPreferences = {};
    for (const id of PRACTICE_IDS) {
      const value = parsed[id];
      if (typeof value === "string") {
        out[id] = persistableTempoKey(id, value);
      }
    }
    return out;
  } catch {
    return {};
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
    current = {};
  }
}

void hydrate();

export function getBreathTempoPreferences(): BreathTempoPreferences {
  return current;
}

export function getBreathTempoForPractice(id: BreathPracticeId): string {
  const stored = current[id];
  // Card + next launch use the persistable (clamped) value, not an in-session overlay outlier.
  return stored != null ? persistableTempoKey(id, stored) : defaultTempoKey(id);
}

/**
 * Persist tempo for one practice type. Intended only after the practice has
 * actually started (or the in-session tempo changed while running).
 */
export async function updateBreathTempoPreference(
  id: BreathPracticeId,
  tempoKey: string,
): Promise<void> {
  const nextKey = persistableTempoKey(id, tempoKey);
  if (current[id] === nextKey) return;
  current = { ...current, [id]: nextKey };
  emit();
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* best effort */
  }
}

export function useBreathTempoPreferences(): BreathTempoPreferences {
  useEffect(() => {
    void hydrate();
  }, []);
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => current,
    () => ({}),
  );
}

export function useBreathTempoForPractice(id: BreathPracticeId | undefined): string {
  const prefs = useBreathTempoPreferences();
  if (id == null) return defaultTempoKey("coherent");
  const stored = prefs[id];
  return stored != null ? persistableTempoKey(id, stored) : defaultTempoKey(id);
}
