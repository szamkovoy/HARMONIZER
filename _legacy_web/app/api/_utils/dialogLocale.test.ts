import { afterEach, describe, expect, it } from "vitest";

import { localeToLanguageName, resolveResponseLocale } from "./dialogLocale";

const ORIGINAL = process.env.DIALOG_RESPONSE_LOCALE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DIALOG_RESPONSE_LOCALE;
  else process.env.DIALOG_RESPONSE_LOCALE = ORIGINAL;
});

describe("localeToLanguageName", () => {
  it("maps known prefixes", () => {
    expect(localeToLanguageName("ru")).toBe("Russian");
    expect(localeToLanguageName("en-US")).toBe("English");
    expect(localeToLanguageName("it")).toBe("Italian");
    expect(localeToLanguageName("de")).toBe("German");
  });
  it("falls back to Russian for unknown/empty", () => {
    expect(localeToLanguageName(null)).toBe("Russian");
    expect(localeToLanguageName("zz")).toBe("Russian");
  });
});

describe("resolveResponseLocale", () => {
  it("defaults to the user's stored locale when no override is set", () => {
    delete process.env.DIALOG_RESPONSE_LOCALE;
    expect(resolveResponseLocale("en")).toBe("en");
    expect(resolveResponseLocale("en-GB")).toBe("en");
    expect(resolveResponseLocale("ru")).toBe("ru");
    expect(resolveResponseLocale(null)).toBe("ru");
  });

  it("env override forces the response locale regardless of the user locale", () => {
    process.env.DIALOG_RESPONSE_LOCALE = "en";
    expect(resolveResponseLocale("ru")).toBe("en");
    process.env.DIALOG_RESPONSE_LOCALE = "ru";
    expect(resolveResponseLocale("en")).toBe("ru");
  });

  it("ignores an unsupported override and falls back to the user locale", () => {
    process.env.DIALOG_RESPONSE_LOCALE = "zz";
    expect(resolveResponseLocale("ru")).toBe("ru");
    expect(resolveResponseLocale("en")).toBe("en");
  });

  it("uses the client-requested locale above the stored user locale", () => {
    delete process.env.DIALOG_RESPONSE_LOCALE;
    expect(resolveResponseLocale("ru", "en")).toBe("en");
    expect(resolveResponseLocale("en", "ru")).toBe("ru");
    expect(resolveResponseLocale("ru", "it")).toBe("it");
    expect(resolveResponseLocale("ru", "fr")).toBe("fr");
    expect(resolveResponseLocale("ru", null)).toBe("ru");
  });

  it("env override still wins over the client-requested locale", () => {
    process.env.DIALOG_RESPONSE_LOCALE = "en";
    expect(resolveResponseLocale("ru", "ru")).toBe("en");
  });
});
