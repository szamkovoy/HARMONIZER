import { describe, expect, it } from "vitest";
import { getDomainPrompt, normalizeWhisperLanguage } from "./whisperPrompts";

describe("getDomainPrompt", () => {
  it("returns Russian prompt for ru locale", () => {
    expect(getDomainPrompt("ru")).toContain("Сахасрара");
    expect(getDomainPrompt("ru")).toContain("Муладхара");
  });

  it("returns English prompt for en locale", () => {
    expect(getDomainPrompt("en")).toContain("Sahasrara");
    expect(getDomainPrompt("en")).toContain("Muladhara");
  });

  it("falls back to Russian for unknown locale", () => {
    expect(getDomainPrompt("xx")).toBe(getDomainPrompt("ru"));
    expect(getDomainPrompt(undefined)).toBe(getDomainPrompt("ru"));
  });

  it("uses multilingual auto-detect prompt for supported European locales", () => {
    // de/fr/it/es/pt/nl не имеют dedicated-промпта → мультиязычный AUTO_DETECT
    // (термины на нескольких языках, чтобы Whisper корректно транскрибировал).
    for (const locale of ["de", "fr", "it", "es", "pt", "nl"]) {
      expect(getDomainPrompt(locale)).toBe(getDomainPrompt("de"));
      expect(getDomainPrompt(locale)).not.toBe(getDomainPrompt("ru"));
      expect(getDomainPrompt(locale)).not.toBe(getDomainPrompt("en"));
    }
  });

  it("keeps the Russian prompt compact", () => {
    expect(getDomainPrompt("ru").length).toBeLessThan(800);
  });
});

describe("normalizeWhisperLanguage", () => {
  it("normalizes app locales to supported Whisper language codes", () => {
    expect(normalizeWhisperLanguage("ru-RU")).toBe("ru");
    expect(normalizeWhisperLanguage("en-US")).toBe("en");
    expect(normalizeWhisperLanguage("de-DE")).toBe("de");
    expect(normalizeWhisperLanguage("fr-FR")).toBe("fr");
    expect(normalizeWhisperLanguage("pt-BR")).toBe("pt");
    expect(normalizeWhisperLanguage("nl-NL")).toBe("nl");
  });

  it("falls back to Russian for missing or unknown locale", () => {
    expect(normalizeWhisperLanguage(undefined)).toBe("ru");
    expect(normalizeWhisperLanguage("")).toBe("ru");
    expect(normalizeWhisperLanguage("xx")).toBe("ru");
    expect(normalizeWhisperLanguage("zh-CN")).toBe("ru");
  });
});
