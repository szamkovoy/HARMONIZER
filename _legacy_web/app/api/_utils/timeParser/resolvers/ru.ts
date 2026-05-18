import { DateTime } from "luxon";

import { DEFAULT_DAYPART_HOURS } from "../config";
import type { ParseEventTimeInput, ResolverResult, TimeResolver } from "../types";

type ExplicitPart = "morning" | "day" | "evening" | "night";

const WORD_HOURS: Record<string, number> = {
  "час": 1,
  "один": 1,
  "одна": 1,
  "одну": 1,
  "два": 2,
  "две": 2,
  "двух": 2,
  "дваx": 2,
  "три": 3,
  "трех": 3,
  "трёх": 3,
  "четыре": 4,
  "четырех": 4,
  "четырёх": 4,
  "пять": 5,
  "пяти": 5,
  "шесть": 6,
  "шести": 6,
  "семь": 7,
  "семи": 7,
  "восемь": 8,
  "восьми": 8,
  "девять": 9,
  "девяти": 9,
  "десять": 10,
  "десяти": 10,
  "одиннадцать": 11,
  "одиннадцати": 11,
  "двенадцать": 12,
  "двенадцати": 12,
  "пару": 2,
};

const GENITIVE_HOURS: Record<string, number> = {
  "первого": 1,
  "второго": 2,
  "третьего": 3,
  "четвертого": 4,
  "четвёртого": 4,
  "пятого": 5,
  "шестого": 6,
  "седьмого": 7,
  "восьмого": 8,
  "девятого": 9,
  "десятого": 10,
  "одиннадцатого": 11,
  "двенадцатого": 12,
};

const WEEKDAYS: Array<{ pattern: RegExp; weekday: number }> = [
  { pattern: /понедельник\w*/, weekday: 1 },
  { pattern: /вторник\w*/, weekday: 2 },
  { pattern: /сред\w*/, weekday: 3 },
  { pattern: /четверг\w*/, weekday: 4 },
  { pattern: /пятниц\w*/, weekday: 5 },
  { pattern: /суббот\w*/, weekday: 6 },
  { pattern: /воскресень\w*/, weekday: 7 },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function atLocal(base: DateTime, hour: number, minute = 0): DateTime {
  return base.set({ hour, minute, second: 0, millisecond: 0 });
}

function parseHourToken(raw: string | undefined): number | null {
  if (!raw) return null;
  const token = raw.trim().replace(/ё/g, "е");
  if (/^\d{1,2}$/.test(token)) {
    const parsed = Number.parseInt(token, 10);
    return parsed >= 0 && parsed <= 23 ? parsed : null;
  }
  return WORD_HOURS[token] ?? null;
}

function parseGenitiveHour(raw: string | undefined): number | null {
  if (!raw) return null;
  return GENITIVE_HOURS[raw.trim().replace(/ё/g, "е")] ?? null;
}

function detectExplicitPart(text: string): ExplicitPart | null {
  if (/утр(а|ом)/.test(text)) return "morning";
  if (/дня/.test(text)) return "day";
  if (/вечер(а|ом)?/.test(text)) return "evening";
  if (/ноч(и|ью)/.test(text)) return "night";
  return null;
}

function hourWithExplicitPart(hour: number, part: ExplicitPart | null): number {
  if (hour > 12 || part == null) return hour;
  if (part === "morning") return hour === 12 ? 0 : hour;
  if (part === "day") return hour === 12 ? 12 : hour + 12;
  if (part === "evening" || part === "night") return hour === 12 ? 12 : hour + 12;
  return hour;
}

function inferAmbiguousHour(nowLocal: DateTime, baseDate: DateTime, hour: number, minute: number, preferEvening: boolean): DateTime {
  if (hour > 12) return atLocal(baseDate, hour, minute);

  const candidates = [atLocal(baseDate, hour === 12 ? 12 : hour, minute)];
  if (hour < 12) candidates.push(atLocal(baseDate, hour + 12, minute));

  if (preferEvening && hour < 12) {
    return atLocal(baseDate, hour + 12, minute);
  }

  let best = candidates[0]!;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const futureCandidate = candidate < nowLocal.minus({ minutes: 30 }) ? candidate.plus({ days: 1 }) : candidate;
    const diff = futureCandidate.toMillis() - nowLocal.toMillis();
    if (diff >= 0 && diff < bestDiff) {
      best = futureCandidate;
      bestDiff = diff;
    }
  }
  return best;
}

function resolveTargetDate(nowLocal: DateTime, text: string): { date: DateTime; matchedPhrase: string | null; hasExplicitFutureDate: boolean } {
  if (/послезавтра/.test(text)) {
    return { date: nowLocal.plus({ days: 2 }).startOf("day"), matchedPhrase: "послезавтра", hasExplicitFutureDate: true };
  }
  if (/завтра/.test(text)) {
    return { date: nowLocal.plus({ days: 1 }).startOf("day"), matchedPhrase: "завтра", hasExplicitFutureDate: true };
  }
  if (/сегодня/.test(text)) {
    return { date: nowLocal.startOf("day"), matchedPhrase: "сегодня", hasExplicitFutureDate: false };
  }
  for (const weekday of WEEKDAYS) {
    const match = text.match(weekday.pattern);
    if (!match) continue;
    const delta = (weekday.weekday - nowLocal.weekday + 7) % 7 || 7;
    return {
      date: nowLocal.plus({ days: delta }).startOf("day"),
      matchedPhrase: match[0] ?? null,
      hasExplicitFutureDate: true,
    };
  }
  return { date: nowLocal.startOf("day"), matchedPhrase: null, hasExplicitFutureDate: false };
}

function parseIsoTime(text: string, nowLocal: DateTime): ResolverResult | null {
  const zone = nowLocal.zoneName ?? "UTC";
  const candidate = DateTime.fromISO(text, { zone });
  if (!candidate.isValid || !text.includes("T")) return null;
  return {
    expectedLocal: candidate.setZone(zone),
    resolution: "explicit",
    matchedPhrase: text.trim(),
    hasExplicitFutureDate: true,
  };
}

function parseRelative(text: string, nowLocal: DateTime): ResolverResult | null {
  if (/через\s+полчаса/.test(text)) {
    return {
      expectedLocal: nowLocal.plus({ minutes: 30 }).startOf("minute"),
      resolution: "explicit",
      matchedPhrase: "через полчаса",
      hasExplicitFutureDate: false,
    };
  }
  if (/через\s+пару\s+час(ов|а)?/.test(text)) {
    return {
      expectedLocal: nowLocal.plus({ hours: 2 }).startOf("minute"),
      resolution: "explicit",
      matchedPhrase: "через пару часов",
      hasExplicitFutureDate: false,
    };
  }
  if (/через\s+час/.test(text)) {
    return {
      expectedLocal: nowLocal.plus({ hours: 1 }).startOf("minute"),
      resolution: "explicit",
      matchedPhrase: "через час",
      hasExplicitFutureDate: false,
    };
  }
  if (/скоро/.test(text)) {
    return {
      expectedLocal: nowLocal.plus({ hours: 1 }).startOf("minute"),
      resolution: "explicit",
      matchedPhrase: "скоро",
      hasExplicitFutureDate: false,
    };
  }
  if (/попозже/.test(text)) {
    return {
      expectedLocal: nowLocal.plus({ hours: 3 }).startOf("minute"),
      resolution: "daypart_default",
      matchedPhrase: "попозже",
      hasExplicitFutureDate: false,
    };
  }
  return null;
}

function parseRange(text: string, nowLocal: DateTime, targetDate: DateTime, hasExplicitFutureDate: boolean): ResolverResult | null {
  const part = detectExplicitPart(text);
  const digitRange = text.match(/(?:между\s+)?(\d{1,2})\s*(?::\d{2})?\s*(?:и|-|–|до)\s*(\d{1,2})/);
  if (digitRange) {
    const right = Number.parseInt(digitRange[2] ?? "", 10);
    if (Number.isFinite(right)) {
      const resolvedHour = hourWithExplicitPart(right, part);
      return {
        expectedLocal: part || hasExplicitFutureDate
          ? atLocal(targetDate, resolvedHour, 0)
          : inferAmbiguousHour(nowLocal, targetDate, right, 0, false),
        resolution: "explicit",
        matchedPhrase: digitRange[0] ?? null,
        hasExplicitFutureDate,
      };
    }
  }

  const wordRange = text.match(/с\s+([а-я0-9]+)\s+до\s+([а-я0-9]+)/);
  if (wordRange) {
    const right = parseHourToken(wordRange[2]);
    if (right != null) {
      const resolvedHour = hourWithExplicitPart(right, part);
      return {
        expectedLocal: part || hasExplicitFutureDate
          ? atLocal(targetDate, resolvedHour, 0)
          : inferAmbiguousHour(nowLocal, targetDate, right, 0, false),
        resolution: "explicit",
        matchedPhrase: wordRange[0] ?? null,
        hasExplicitFutureDate,
      };
    }
  }

  return null;
}

function parseColloquial(text: string, nowLocal: DateTime, targetDate: DateTime, hasExplicitFutureDate: boolean): ResolverResult | null {
  const compactHalf = text.match(/пол([а-я]+)/);
  if (compactHalf) {
    const nextHour = parseGenitiveHour(`${compactHalf[1]}`);
    if (nextHour != null) {
      const hour = nextHour - 1 <= 0 ? 12 : nextHour - 1;
      return {
        expectedLocal: inferAmbiguousHour(nowLocal, targetDate, hour, 30, true),
        resolution: "explicit",
        matchedPhrase: compactHalf[0] ?? null,
        hasExplicitFutureDate,
      };
    }
  }

  const half = text.match(/половина\s+([а-я]+)/);
  if (half) {
    const nextHour = parseGenitiveHour(half[1]);
    if (nextHour != null) {
      const hour = nextHour - 1 <= 0 ? 12 : nextHour - 1;
      return {
        expectedLocal: inferAmbiguousHour(nowLocal, targetDate, hour, 30, true),
        resolution: "explicit",
        matchedPhrase: half[0] ?? null,
        hasExplicitFutureDate,
      };
    }
  }

  const quarterPast = text.match(/четверть\s+([а-я]+)/);
  if (quarterPast) {
    const nextHour = parseGenitiveHour(quarterPast[1]);
    if (nextHour != null) {
      const hour = nextHour - 1 <= 0 ? 12 : nextHour - 1;
      return {
        expectedLocal: inferAmbiguousHour(nowLocal, targetDate, hour, 15, true),
        resolution: "explicit",
        matchedPhrase: quarterPast[0] ?? null,
        hasExplicitFutureDate,
      };
    }
  }

  const quarterTo = text.match(/без\s+четверти\s+([а-я]+)/);
  if (quarterTo) {
    const hour = parseHourToken(quarterTo[1]);
    if (hour != null) {
      const previousHour = hour - 1 <= 0 ? 12 : hour - 1;
      return {
        expectedLocal: inferAmbiguousHour(nowLocal, targetDate, previousHour, 45, true),
        resolution: "explicit",
        matchedPhrase: quarterTo[0] ?? null,
        hasExplicitFutureDate,
      };
    }
  }

  return null;
}

function parseExact(text: string, nowLocal: DateTime, targetDate: DateTime, hasExplicitFutureDate: boolean): ResolverResult | null {
  const part = detectExplicitPart(text);
  const hhmm = text.match(/(?:^|\s)(?:в|к)?\s*(\d{1,2}):(\d{2})(?:\s*(утра|дня|вечера|ночи))?/);
  if (hhmm) {
    const rawHour = Number.parseInt(hhmm[1] ?? "", 10);
    const minute = Number.parseInt(hhmm[2] ?? "", 10);
    if (Number.isFinite(rawHour) && Number.isFinite(minute)) {
      const matchPart = detectExplicitPart(hhmm[0] ?? "") ?? part;
      const resolvedHour = hourWithExplicitPart(rawHour, matchPart);
      return {
        expectedLocal: matchPart || rawHour > 12 || hasExplicitFutureDate
          ? atLocal(targetDate, resolvedHour, minute)
          : inferAmbiguousHour(nowLocal, targetDate, rawHour, minute, false),
        resolution: "explicit",
        matchedPhrase: hhmm[0] ?? null,
        hasExplicitFutureDate,
      };
    }
  }

  const hourWords = text.match(/(?:^|\s)(?:в|к)\s+(\d{1,2}|[а-я]+)(?:\s*час(?:ов|а|ам)?)?(?:\s*(утра|дня|вечера|ночи))?/);
  if (hourWords) {
    const rawHour = parseHourToken(hourWords[1]);
    if (rawHour != null) {
      const matchPart = detectExplicitPart(hourWords[0] ?? "") ?? part;
      const resolvedHour = hourWithExplicitPart(rawHour, matchPart);
      const preferEvening = rawHour === 7 && matchPart == null && nowLocal.hour < 12;
      return {
        expectedLocal: matchPart || rawHour > 12 || hasExplicitFutureDate
          ? atLocal(targetDate, resolvedHour, 0)
          : inferAmbiguousHour(nowLocal, targetDate, rawHour, 0, preferEvening),
        resolution: "explicit",
        matchedPhrase: hourWords[0] ?? null,
        hasExplicitFutureDate,
      };
    }
  }

  return null;
}

function parseDaypart(text: string, targetDate: DateTime, hasExplicitFutureDate: boolean): ResolverResult | null {
  const mappings: Array<{ pattern: RegExp; hour: number; phrase: string }> = [
    { pattern: /поздно вечером/, hour: DEFAULT_DAYPART_HOURS.lateEvening, phrase: "поздно вечером" },
    { pattern: /во второй половине дня/, hour: DEFAULT_DAYPART_HOURS.secondHalf, phrase: "во второй половине дня" },
    { pattern: /после обеда/, hour: DEFAULT_DAYPART_HOURS.afterLunch, phrase: "после обеда" },
    { pattern: /(?:ближе к обеду|в обед)/, hour: DEFAULT_DAYPART_HOURS.noonish, phrase: "в обед" },
    { pattern: /(?:с утра|утречком|утром)/, hour: DEFAULT_DAYPART_HOURS.morning, phrase: "утром" },
    { pattern: /(?:днем|днём)/, hour: DEFAULT_DAYPART_HOURS.day, phrase: "днем" },
    { pattern: /(?:вечерком|вечером)/, hour: DEFAULT_DAYPART_HOURS.evening, phrase: "вечером" },
    { pattern: /(?:к ночи|ночью)/, hour: DEFAULT_DAYPART_HOURS.night, phrase: "ночью" },
  ];

  for (const mapping of mappings) {
    const match = text.match(mapping.pattern);
    if (!match) continue;
    return {
      expectedLocal: atLocal(targetDate, mapping.hour, 0),
      resolution: "daypart_default",
      matchedPhrase: match[0] ?? mapping.phrase,
      hasExplicitFutureDate,
    };
  }
  return null;
}

export const ruTimeResolver: TimeResolver = {
  parse(input: ParseEventTimeInput): ResolverResult | null {
    const nowLocal = input.nowLocal.setZone(input.tz || input.nowLocal.zoneName || "UTC");
    const normalized = normalizeText(input.phrase);
    if (!normalized) return null;

    const iso = parseIsoTime(input.phrase.trim(), nowLocal);
    if (iso) return iso;

    const { date: targetDate, matchedPhrase: datePhrase, hasExplicitFutureDate } = resolveTargetDate(nowLocal, normalized);

    const relative = parseRelative(normalized, nowLocal);
    if (relative) return relative;

    const range = parseRange(normalized, nowLocal, targetDate, hasExplicitFutureDate);
    if (range) return range;

    const colloquial = parseColloquial(normalized, nowLocal, targetDate, hasExplicitFutureDate);
    if (colloquial) return colloquial;

    const exact = parseExact(normalized, nowLocal, targetDate, hasExplicitFutureDate);
    if (exact) return exact;

    const daypart = parseDaypart(normalized, targetDate, hasExplicitFutureDate);
    if (daypart) return daypart;

    if (datePhrase) {
      return {
        expectedLocal: atLocal(targetDate, DEFAULT_DAYPART_HOURS.fallback, 0),
        resolution: "fallback_default",
        matchedPhrase: datePhrase,
        hasExplicitFutureDate,
      };
    }

    return null;
  },
};
