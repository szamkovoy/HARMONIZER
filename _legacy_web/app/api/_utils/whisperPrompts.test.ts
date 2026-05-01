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
  });

  it("keeps the Russian prompt compact", () => {
    expect(getDomainPrompt("ru").length).toBeLessThan(800);
  });
});

describe("normalizeWhisperLanguage", () => {
  it("normalizes app locales to supported Whisper language codes", () => {
    expect(normalizeWhisperLanguage("ru-RU")).toBe("ru");
    expect(normalizeWhisperLanguage("en-US")).toBe("en");
    expect(normalizeWhisperLanguage(undefined)).toBe("ru");
  });
});
