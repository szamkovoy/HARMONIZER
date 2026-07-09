import { describe, expect, it } from "vitest";

import { pickLocalizedText, pickLocalizedTextOrNull, pickLocalizedUrl } from "@/modules/i18n/pickLocalizedContent";

describe("pickLocalizedText", () => {
  const translations = { en: "Hello", it: "Ciao" };

  it("returns RU source for ru locale", () => {
    expect(pickLocalizedText("ru", "Привет", translations)).toBe("Привет");
  });

  it("returns translation for target locale", () => {
    expect(pickLocalizedText("it", "Привет", translations)).toBe("Ciao");
  });

  it("falls back to RU when translation missing", () => {
    expect(pickLocalizedText("de", "Привет", translations)).toBe("Привет");
  });

  it("returns null helper when empty", () => {
    expect(pickLocalizedTextOrNull("it", "  ", { it: "  " })).toBeNull();
  });
});

describe("pickLocalizedUrl", () => {
  it("prefers locale-specific cover", () => {
    expect(pickLocalizedUrl("it", "https://ru.jpg", { it: "https://it.jpg" })).toBe("https://it.jpg");
  });

  it("falls back to RU cover", () => {
    expect(pickLocalizedUrl("de", "https://ru.jpg", {})).toBe("https://ru.jpg");
  });
});
