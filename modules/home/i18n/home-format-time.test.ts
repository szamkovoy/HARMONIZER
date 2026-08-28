import { describe, expect, it } from "vitest";

import { getHomeStrings } from "@/modules/home/i18n/home";
import type { AppContentLocale } from "@/modules/i18n/localeCodes";

/** Fixed UTC instant → 21:06 in Europe/Moscow; local wall clock depends on the runner TZ. */
const SAMPLE = "2026-08-28T18:06:00.000Z";

describe("getHomeStrings.formatTime", () => {
  it("uses 12-hour clock only for English", () => {
    const en = getHomeStrings("en").formatTime(SAMPLE);
    expect(en).toMatch(/\b(AM|PM)\b/i);
  });

  it.each(["ru", "de", "fr", "it", "es", "pt", "nl"] as const satisfies readonly AppContentLocale[])(
    "uses 24-hour clock for %s",
    (locale) => {
      const formatted = getHomeStrings(locale).formatTime(SAMPLE);
      expect(formatted).not.toMatch(/\b(AM|PM)\b/i);
      expect(formatted).toMatch(/\d{1,2}.\d{2}/);
    },
  );
});
