import { DateTime } from "luxon";

import { DEFAULT_DAYPART_HOURS, PAST_EVENT_GRACE_MINUTES, PAST_EVENT_REWRITE_MINUTES } from "./config";
import { enTimeResolver } from "./resolvers/en";
import { ruTimeResolver } from "./resolvers/ru";
import type { ParseEventTimeInput, ParseEventTimeResult, ResolverResult } from "./types";

function fallbackLocal(nowLocal: DateTime): DateTime {
  let candidate = nowLocal.set({
    hour: DEFAULT_DAYPART_HOURS.fallback,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  if (candidate < nowLocal.minus({ minutes: PAST_EVENT_GRACE_MINUTES })) {
    candidate = candidate.plus({ days: 1 });
  }
  return candidate;
}

function normalizeLocale(locale: string | null | undefined): string {
  return locale?.trim().toLowerCase() ?? "ru";
}

function finalize(nowLocal: DateTime, parsed: ResolverResult | null): ParseEventTimeResult {
  let expectedLocal = parsed?.expectedLocal ?? fallbackLocal(nowLocal);
  const resolution = parsed?.resolution ?? "fallback_default";
  const matchedPhrase = parsed?.matchedPhrase ?? null;

  if (
    expectedLocal < nowLocal.minus({ minutes: PAST_EVENT_GRACE_MINUTES })
    && !parsed?.hasExplicitFutureDate
  ) {
    expectedLocal = nowLocal.plus({ minutes: PAST_EVENT_REWRITE_MINUTES }).startOf("minute");
  }

  return {
    expectedLocal,
    expectedUtc: expectedLocal.toUTC().toISO() ?? expectedLocal.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'"),
    resolution,
    matchedPhrase,
  };
}

export function parseEventTime(input: ParseEventTimeInput): ParseEventTimeResult {
  const nowLocal = input.nowLocal.setZone(input.tz || input.nowLocal.zoneName || "UTC");
  const locale = normalizeLocale(input.locale);

  const resolver = locale.startsWith("en") ? enTimeResolver : ruTimeResolver;
  const parsed = resolver.parse({ ...input, nowLocal });

  return finalize(nowLocal, parsed);
}

export type { ParseEventTimeInput, ParseEventTimeResult, TimeResolution } from "./types";
