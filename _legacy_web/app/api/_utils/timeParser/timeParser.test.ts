import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { canonicalizeTimeResolution, parseEventTime } from "./index";

type Case = {
  phrase: string;
  now: string;
  expected: string;
  resolution: "explicit" | "daypart_default" | "fallback_default";
  locale?: string;
};

const TZ = "Europe/Moscow";

function runCase(testCase: Case) {
  const nowLocal = DateTime.fromISO(testCase.now, { zone: TZ });
  const result = parseEventTime({
    phrase: testCase.phrase,
    nowLocal,
    tz: TZ,
    locale: testCase.locale ?? "ru",
  });

  expect(result.expectedLocal.toFormat("yyyy-MM-dd HH:mm")).toBe(testCase.expected);
  expect(result.resolution).toBe(testCase.resolution);
  expect(result.expectedUtc).toBe(result.expectedLocal.toUTC().toISO());
}

describe("parseEventTime", () => {
  const cases: Case[] = [
    { phrase: "в 18:00", now: "2026-05-16T09:00:00", expected: "2026-05-16 18:00", resolution: "explicit" },
    { phrase: "к 18 часам", now: "2026-05-16T09:00:00", expected: "2026-05-16 18:00", resolution: "explicit" },
    { phrase: "в 9 утра", now: "2026-05-16T09:00:00", expected: "2026-05-16 09:00", resolution: "explicit" },
    { phrase: "в 21:30", now: "2026-05-16T09:00:00", expected: "2026-05-16 21:30", resolution: "explicit" },
    { phrase: "в полдевятого", now: "2026-05-16T09:00:00", expected: "2026-05-16 20:30", resolution: "explicit" },
    { phrase: "без четверти три", now: "2026-05-16T09:00:00", expected: "2026-05-16 14:45", resolution: "explicit" },
    { phrase: "четверть третьего", now: "2026-05-16T09:00:00", expected: "2026-05-16 14:15", resolution: "explicit" },
    { phrase: "половина седьмого", now: "2026-05-16T09:00:00", expected: "2026-05-16 18:30", resolution: "explicit" },
    { phrase: "в 7", now: "2026-05-16T08:00:00", expected: "2026-05-16 19:00", resolution: "explicit" },
    { phrase: "в 7", now: "2026-05-16T13:00:00", expected: "2026-05-16 19:00", resolution: "explicit" },
    { phrase: "в 7", now: "2026-05-16T20:30:00", expected: "2026-05-17 07:00", resolution: "explicit" },
    { phrase: "с двух до четырех", now: "2026-05-16T09:00:00", expected: "2026-05-16 16:00", resolution: "explicit" },
    { phrase: "между 14 и 16", now: "2026-05-16T09:00:00", expected: "2026-05-16 16:00", resolution: "explicit" },
    { phrase: "часа в 3-4 дня", now: "2026-05-16T09:00:00", expected: "2026-05-16 16:00", resolution: "explicit" },
    { phrase: "утром", now: "2026-05-16T09:00:00", expected: "2026-05-16 10:00", resolution: "daypart_default" },
    { phrase: "с утра созвон", now: "2026-05-16T09:00:00", expected: "2026-05-16 10:00", resolution: "daypart_default" },
    { phrase: "утречком", now: "2026-05-16T09:00:00", expected: "2026-05-16 10:00", resolution: "daypart_default" },
    { phrase: "ближе к обеду", now: "2026-05-16T09:00:00", expected: "2026-05-16 13:00", resolution: "daypart_default" },
    { phrase: "в обед", now: "2026-05-16T09:00:00", expected: "2026-05-16 13:00", resolution: "daypart_default" },
    { phrase: "после обеда", now: "2026-05-16T09:00:00", expected: "2026-05-16 15:00", resolution: "daypart_default" },
    { phrase: "днем", now: "2026-05-16T09:00:00", expected: "2026-05-16 16:00", resolution: "daypart_default" },
    { phrase: "во второй половине дня", now: "2026-05-16T09:00:00", expected: "2026-05-16 17:00", resolution: "daypart_default" },
    { phrase: "вечерком", now: "2026-05-16T09:00:00", expected: "2026-05-16 20:00", resolution: "daypart_default" },
    { phrase: "вечером", now: "2026-05-16T09:00:00", expected: "2026-05-16 20:00", resolution: "daypart_default" },
    { phrase: "поздно вечером", now: "2026-05-16T09:00:00", expected: "2026-05-16 22:00", resolution: "daypart_default" },
    { phrase: "к ночи", now: "2026-05-16T09:00:00", expected: "2026-05-16 23:00", resolution: "daypart_default" },
    { phrase: "через час", now: "2026-05-16T09:00:00", expected: "2026-05-16 10:00", resolution: "explicit" },
    { phrase: "через пару часов", now: "2026-05-16T09:15:00", expected: "2026-05-16 11:15", resolution: "explicit" },
    { phrase: "через полчаса", now: "2026-05-16T09:15:00", expected: "2026-05-16 09:45", resolution: "explicit" },
    { phrase: "скоро", now: "2026-05-16T09:15:00", expected: "2026-05-16 10:15", resolution: "explicit" },
    { phrase: "попозже", now: "2026-05-16T09:15:00", expected: "2026-05-16 12:15", resolution: "daypart_default" },
    { phrase: "завтра вечером", now: "2026-05-16T09:00:00", expected: "2026-05-17 20:00", resolution: "daypart_default" },
    { phrase: "послезавтра утром", now: "2026-05-16T09:00:00", expected: "2026-05-18 10:00", resolution: "daypart_default" },
    { phrase: "в субботу днем", now: "2026-05-14T09:00:00", expected: "2026-05-16 16:00", resolution: "daypart_default" },
    { phrase: "завтра", now: "2026-05-16T09:00:00", expected: "2026-05-17 18:00", resolution: "fallback_default" },
    { phrase: "что-то важное", now: "2026-05-16T12:00:00", expected: "2026-05-16 18:00", resolution: "fallback_default" },
    { phrase: "что-то важное", now: "2026-05-16T21:00:00", expected: "2026-05-17 18:00", resolution: "fallback_default" },
    { phrase: "утром встреча", now: "2026-05-16T14:00:00", expected: "2026-05-16 14:15", resolution: "daypart_default" },
    { phrase: "в 9 утра", now: "2026-05-16T16:00:00", expected: "2026-05-16 16:15", resolution: "explicit" },
    { phrase: "с двух до четырех", now: "2026-05-16T16:00:00", expected: "2026-05-16 16:00", resolution: "explicit" },
    { phrase: "завтра в 7 вечера", now: "2026-05-16T09:00:00", expected: "2026-05-17 19:00", resolution: "explicit" },
    { phrase: "2026-05-17T15:30:00", now: "2026-05-16T09:00:00", expected: "2026-05-17 15:30", resolution: "explicit", locale: "en" },
    { phrase: "3:45 pm", now: "2026-05-16T09:00:00", expected: "2026-05-16 15:45", resolution: "explicit", locale: "en" },
    { phrase: "sometime later", now: "2026-05-16T21:00:00", expected: "2026-05-17 18:00", resolution: "fallback_default", locale: "en" },
  ];

  it("covers Russian and English resolver cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    for (const testCase of cases) runCase(testCase);
  });

  it("returns matched phrase when it recognizes a Russian relative expression", () => {
    const nowLocal = DateTime.fromISO("2026-05-16T09:15:00", { zone: TZ });
    const result = parseEventTime({
      phrase: "давай через пару часов созвонимся",
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(result.matchedPhrase).toBe("через пару часов");
  });

  it("falls back with null matched phrase when nothing is recognized", () => {
    const nowLocal = DateTime.fromISO("2026-05-16T12:00:00", { zone: TZ });
    const result = parseEventTime({
      phrase: "как-нибудь потом",
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(result.matchedPhrase).toBeNull();
    expect(result.resolution).toBe("fallback_default");
    expect(result.expectedLocal.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-05-16 18:00");
  });

  it("canonicalizes legacy daypart resolution to db-safe value", () => {
    expect(canonicalizeTimeResolution("daypart")).toBe("daypart_default");
    expect(canonicalizeTimeResolution("daypart_default")).toBe("daypart_default");
    expect(canonicalizeTimeResolution("explicit")).toBe("explicit");
    expect(canonicalizeTimeResolution("unknown")).toBe("fallback_default");
  });
});
