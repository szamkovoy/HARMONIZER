import { DateTime } from "luxon";

import type { ParseEventTimeInput, ResolverResult, TimeResolver } from "../types";

function parseIsoOrClock(value: string, nowLocal: DateTime): ResolverResult | null {
  const zone = nowLocal.zoneName ?? "UTC";
  const iso = DateTime.fromISO(value.trim(), { zone });
  if (iso.isValid && value.includes("T")) {
    return {
      expectedLocal: iso.setZone(zone),
      resolution: "explicit",
      matchedPhrase: value.trim(),
      hasExplicitFutureDate: true,
    };
  }

  const normalized = value.trim().toLowerCase();
  const hhmm = normalized.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  if (!hhmm) return null;

  let hour = Number.parseInt(hhmm[1] ?? "", 10);
  const minute = Number.parseInt(hhmm[2] ?? "", 10);
  const meridiem = hhmm[3];
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return {
    expectedLocal: nowLocal.set({ hour, minute, second: 0, millisecond: 0 }),
    resolution: "explicit",
    matchedPhrase: hhmm[0] ?? null,
    hasExplicitFutureDate: false,
  };
}

export const enTimeResolver: TimeResolver = {
  parse(input: ParseEventTimeInput): ResolverResult | null {
    return parseIsoOrClock(input.phrase, input.nowLocal.setZone(input.tz || input.nowLocal.zoneName || "UTC"));
  },
};
