/** Exclusive audio bed for breath/meditation (launch param `soundBed`). */
export const SOUND_BED_NEURO_SYNC = "neuro-sync" as const;

export const NATURE_SOUND_BED_IDS = [
  "creek",
  "waves",
  "rain",
  "forest_birds",
  "wind",
  "fireplace",
  "water_splash",
  "cat_purr",
] as const;

export type NatureSoundBedId = (typeof NATURE_SOUND_BED_IDS)[number];
export type SoundBedId = typeof SOUND_BED_NEURO_SYNC | NatureSoundBedId;

export const SOUND_BED_IDS: readonly SoundBedId[] = [SOUND_BED_NEURO_SYNC, ...NATURE_SOUND_BED_IDS];

/**
 * Default nature bed for Calm meditation. Binaural (neuro-sync) bed is no
 * longer offered for Calm — it relied on short pre-baked loops that the user
 * perceived as a "looped fragment" instead of a continuous frequency sweep.
 * Nature beds loop seamlessly at each file's own natural duration (the
 * user trimmed the edges to be gapless), which is the intended experience.
 */
export const CALM_DEFAULT_SOUND_BED: NatureSoundBedId = "creek";

export function isSoundBedId(value: unknown): value is SoundBedId {
  return typeof value === "string" && (SOUND_BED_IDS as readonly string[]).includes(value);
}

export function isNatureSoundBedId(value: unknown): value is NatureSoundBedId {
  return typeof value === "string" && (NATURE_SOUND_BED_IDS as readonly string[]).includes(value);
}

export function parseSoundBedId(value: unknown): SoundBedId {
  return isSoundBedId(value) ? value : SOUND_BED_NEURO_SYNC;
}

/**
 * Validate a sound bed for Calm meditation. Rejects `neuro-sync` (no longer
 * offered for Calm) and falls back to {@link CALM_DEFAULT_SOUND_BED}. Any
 * nature bed passes through. Used by `calmPreferences` so a previously-stored
 * `neuro-sync` choice migrates to a nature bed automatically.
 */
export function parseCalmSoundBedId(value: unknown): NatureSoundBedId {
  return isNatureSoundBedId(value) ? value : CALM_DEFAULT_SOUND_BED;
}
