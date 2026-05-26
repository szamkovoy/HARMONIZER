import type { DateTime } from "luxon";

export type TimeResolution = "explicit" | "daypart_default" | "fallback_default";

export interface ParseEventTimeInput {
  phrase: string;
  nowLocal: DateTime;
  relativeNowLocal?: DateTime;
  tz: string;
  locale?: string | null;
}

export interface ParseEventTimeResult {
  expectedLocal: DateTime;
  expectedUtc: string;
  resolution: TimeResolution;
  matchedPhrase: string | null;
}

export interface DaypartDefaultHours {
  morning: number;
  noonish: number;
  day: number;
  afterLunch: number;
  secondHalf: number;
  evening: number;
  lateEvening: number;
  night: number;
  fallback: number;
}

export interface ResolverResult {
  expectedLocal: DateTime;
  resolution: TimeResolution;
  matchedPhrase: string | null;
  hasExplicitFutureDate: boolean;
}

export interface TimeResolver {
  parse(input: ParseEventTimeInput): ResolverResult | null;
}
