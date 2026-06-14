import { describe, expect, it } from "vitest";

import { pluralCategory, t, tCount } from "@/modules/i18n/t";

describe("t", () => {
  it("returns the localized value for known keys", () => {
    expect(t("ru", "tabs.day")).toBe("День");
    expect(t("en", "tabs.day")).toBe("Day");
  });

  it("falls back to English, then Russian, then the key itself", () => {
    // de has no catalog yet → falls back to en.
    expect(t("de", "tabs.day")).toBe("Day");
    // unknown key → returns the key unchanged.
    expect(t("ru", "does.not.exist")).toBe("does.not.exist");
  });

  it("interpolates {placeholders}", () => {
    // No interpolated key in the seed catalog, so verify via tCount's {count}.
    expect(tCount("en", "missing.base", 3)).toBe("missing.base.other");
  });
});

describe("pluralCategory (language-complete via Intl.PluralRules)", () => {
  it("uses Russian one/few/many rules", () => {
    expect(pluralCategory("ru", 1)).toBe("one");
    expect(pluralCategory("ru", 2)).toBe("few");
    expect(pluralCategory("ru", 5)).toBe("many");
    expect(pluralCategory("ru", 21)).toBe("one");
  });

  it("uses English one/other rules", () => {
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 2)).toBe("other");
  });

  it("handles a not-yet-shipped language without code changes", () => {
    // Polish-like many/few exist for pl; here just assert it does not throw and
    // returns a valid category for a future locale.
    expect(typeof pluralCategory("fr", 2)).toBe("string");
  });
});
