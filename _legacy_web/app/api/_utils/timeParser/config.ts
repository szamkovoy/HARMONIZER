import type { DaypartDefaultHours } from "./types";

export const DEFAULT_DAYPART_HOURS: DaypartDefaultHours = {
  morning: 10,
  noonish: 13,
  day: 16,
  afterLunch: 15,
  secondHalf: 17,
  evening: 20,
  lateEvening: 22,
  night: 23,
  fallback: 16,
};

export const PAST_EVENT_GRACE_MINUTES = 30;
export const PAST_EVENT_REWRITE_MINUTES = 15;
