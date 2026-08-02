import type { SoundBedId } from "@/modules/mandala-sound/core/soundBed";

/** Catalog slug — not offered by assistant; never written to practice_sessions. */
export const CALM_PRACTICE_SLUG = "calm";
export const CALM_PRACTICE_ID = "meditation:calm";

/** Minutes: 3…8 h (includes 1.5 h = 90). */
export const CALM_DURATION_MINUTES = [
  3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480,
] as const;

export type CalmDurationMinutes = (typeof CALM_DURATION_MINUTES)[number];

export function isCalmPracticeSlug(slug: string | null | undefined): boolean {
  return slug === CALM_PRACTICE_SLUG;
}

export function isCalmPractice(practice: { slug: string }): boolean {
  return isCalmPracticeSlug(practice.slug);
}

export function isCalmDurationMinutes(value: number): value is CalmDurationMinutes {
  return (CALM_DURATION_MINUTES as readonly number[]).includes(value);
}
