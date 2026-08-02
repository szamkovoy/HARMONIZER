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

export function isSoundBedId(value: unknown): value is SoundBedId {
  return typeof value === "string" && (SOUND_BED_IDS as readonly string[]).includes(value);
}

export function isNatureSoundBedId(value: unknown): value is NatureSoundBedId {
  return typeof value === "string" && (NATURE_SOUND_BED_IDS as readonly string[]).includes(value);
}

export function parseSoundBedId(value: unknown): SoundBedId {
  return isSoundBedId(value) ? value : SOUND_BED_NEURO_SYNC;
}
