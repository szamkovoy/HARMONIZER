import { describe, expect, it } from "vitest";

import {
  hasExactLocalizedTitle,
  hasLocalizedTitle,
  pickExactLocalizedText,
  pickExactLocalizedUrl,
  pickLocalizedText,
  pickLocalizedTextOrNull,
  pickLocalizedUrl,
} from "@/modules/i18n/pickLocalizedContent";

describe("pickLocalizedText (soft fallback)", () => {
  const translations = { en: "Hello", it: "Ciao" };

  it("returns RU source for ru locale", () => {
    expect(pickLocalizedText("ru", "Привет", translations)).toBe("Привет");
  });

  it("returns translation for target locale", () => {
    expect(pickLocalizedText("it", "Привет", translations)).toBe("Ciao");
  });

  it("falls back to EN before RU for non-RU locales", () => {
    expect(pickLocalizedText("de", "Привет", translations)).toBe("Hello");
  });

  it("falls back to RU when EN and preferred missing", () => {
    expect(pickLocalizedText("de", "Привет", {})).toBe("Привет");
  });

  it("returns null helper when empty", () => {
    expect(pickLocalizedTextOrNull("it", "  ", { it: "  " })).toBeNull();
  });
});

describe("pickExactLocalizedText", () => {
  it("returns only the preferred locale", () => {
    expect(pickExactLocalizedText("it", "Привет", { en: "Hello", it: "Ciao" })).toBe("Ciao");
    expect(pickExactLocalizedText("de", "Привет", { en: "Hello" })).toBe("");
    expect(pickExactLocalizedText("ru", "Привет", { en: "Hello" })).toBe("Привет");
  });

  it("does not fall back for covers", () => {
    expect(pickExactLocalizedUrl("de", "https://ru.jpg", { en: "https://en.jpg" })).toBeNull();
    expect(pickExactLocalizedUrl("it", "https://ru.jpg", { it: "https://it.jpg" })).toBe(
      "https://it.jpg",
    );
  });
});

describe("hasLocalizedTitle", () => {
  it("soft helper is true when EN exists for DE preference", () => {
    expect(hasLocalizedTitle("de", "RU", { en: "EN" })).toBe(true);
  });

  it("exact helper is false when only EN exists for DE", () => {
    expect(hasExactLocalizedTitle("de", "RU", { en: "EN" })).toBe(false);
    expect(hasExactLocalizedTitle("it", "RU", { it: "IT" })).toBe(true);
  });
});

describe("pickLocalizedUrl", () => {
  it("prefers locale-specific cover", () => {
    expect(pickLocalizedUrl("it", "https://ru.jpg", { it: "https://it.jpg" })).toBe("https://it.jpg");
  });

  it("falls back to EN cover before RU", () => {
    expect(pickLocalizedUrl("de", "https://ru.jpg", { en: "https://en.jpg" })).toBe("https://en.jpg");
  });

  it("falls back to RU cover", () => {
    expect(pickLocalizedUrl("de", "https://ru.jpg", {})).toBe("https://ru.jpg");
  });
});
