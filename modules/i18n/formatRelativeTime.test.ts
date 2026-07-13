import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "@/modules/i18n/formatRelativeTime";
import type { AppLocale } from "@/modules/i18n/localeStore";

const LOCALES: AppLocale[] = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"];

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-13T15:00:00.000Z");

  it("uses abbreviated Russian units without declension", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 60_000), "ru", now)).toBe("1 мин");
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 60_000), "ru", now)).toBe("2 мин");
    expect(formatRelativeTime(new Date(now.getTime() - 15 * 60_000), "ru", now)).toBe("15 мин");
  });

  it("uses abbreviated English units", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 7 * 60_000), "en", now)).toBe("7 min");
  });

  it("shows only the dominant unit (hours hide minutes)", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 3600_000 - 20 * 60_000), "ru", now)).toBe("2 ч");
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 86400_000 - 5 * 3600_000), "en", now)).toBe("3 d");
  });

  it("returns just-now for very recent timestamps in all supported locales", () => {
    for (const locale of LOCALES) {
      const text = formatRelativeTime(new Date(now.getTime() - 1_000), locale, now);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/minutes? ago|минут/i);
    }
  });

  it("never falls back to English long forms for non-EN locales", () => {
    const nonEn = LOCALES.filter((l) => l !== "en");
    for (const locale of nonEn) {
      const text = formatRelativeTime(new Date(now.getTime() - 7 * 60_000), locale, now);
      expect(text).not.toMatch(/minutes? ago/i);
      expect(text).toMatch(/\d/);
    }
  });
});
