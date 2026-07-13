import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "@/modules/i18n/formatRelativeTime";
import type { AppLocale } from "@/modules/i18n/localeStore";

const LOCALES: AppLocale[] = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"];

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-13T15:00:00.000Z");

  it("uses Russian plural forms for past minutes", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 60_000), "ru", now)).toBe("1 минуту назад");
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 60_000), "ru", now)).toBe("2 минуты назад");
    expect(formatRelativeTime(new Date(now.getTime() - 7 * 60_000), "ru", now)).toBe("7 минут назад");
  });

  it("uses English for en locale", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 7 * 60_000), "en", now)).toBe("7 minutes ago");
  });

  it("returns just-now for very recent timestamps in all supported locales", () => {
    for (const locale of LOCALES) {
      const text = formatRelativeTime(new Date(now.getTime() - 1_000), locale, now);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/minutes? ago/i);
    }
  });

  it("never falls back to English minutes-ago for non-EN locales", () => {
    const nonEn = LOCALES.filter((l) => l !== "en");
    for (const locale of nonEn) {
      const text = formatRelativeTime(new Date(now.getTime() - 7 * 60_000), locale, now);
      expect(text).not.toMatch(/minutes? ago/i);
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
