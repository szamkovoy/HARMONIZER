import { describe, expect, it } from "vitest";

import {
  localesMissingPostContent,
  pickPostTranslateSource,
  sanitizePostFillLocales,
  type PostTargetLocale,
} from "./postTranslate";

function emptyTabs(): Record<PostTargetLocale, { title: string; body: string }> {
  return {
    en: { title: "", body: "" },
    de: { title: "", body: "" },
    fr: { title: "", body: "" },
    it: { title: "", body: "" },
    es: { title: "", body: "" },
    pt: { title: "", body: "" },
    nl: { title: "", body: "" },
  };
}

describe("pickPostTranslateSource", () => {
  it("prefers active EN when EN has title even if RU is also filled", () => {
    const tabs = emptyTabs();
    tabs.en = { title: "English title", body: "EN body" };
    const source = pickPostTranslateSource("en", { title: "RU title", body: "RU body" }, tabs);
    expect(source).toEqual({ locale: "en", title: "English title", body: "EN body" });
  });

  it("uses RU when active RU has title", () => {
    const tabs = emptyTabs();
    tabs.en = { title: "English title", body: "EN body" };
    const source = pickPostTranslateSource("ru", { title: "RU title", body: "RU body" }, tabs);
    expect(source).toEqual({ locale: "ru", title: "RU title", body: "RU body" });
  });

  it("falls back to first filled locale when active tab is empty", () => {
    const tabs = emptyTabs();
    tabs.de = { title: "DE title", body: "DE body" };
    const source = pickPostTranslateSource("en", { title: "", body: "" }, tabs);
    expect(source).toEqual({ locale: "de", title: "DE title", body: "DE body" });
  });
});

describe("localesMissingPostContent", () => {
  it("from RU fills all empty non-RU locales", () => {
    const tabs = emptyTabs();
    expect(localesMissingPostContent(tabs, "ru")).toEqual([
      "en",
      "de",
      "fr",
      "it",
      "es",
      "pt",
      "nl",
    ]);
  });

  it("from EN fills empty locales and never includes RU", () => {
    const tabs = emptyTabs();
    tabs.en = { title: "EN", body: "" };
    const missing = localesMissingPostContent(tabs, "en");
    expect(missing).toEqual(["de", "fr", "it", "es", "pt", "nl"]);
    expect(missing).not.toContain("ru");
  });

  it("skips locales that already have a title", () => {
    const tabs = emptyTabs();
    tabs.en = { title: "EN", body: "" };
    tabs.de = { title: "DE", body: "" };
    expect(localesMissingPostContent(tabs, "en")).toEqual(["fr", "it", "es", "pt", "nl"]);
  });
});

describe("sanitizePostFillLocales", () => {
  it("strips ru when source is en", () => {
    expect(sanitizePostFillLocales("en", ["ru", "de", "fr", "en"])).toEqual(["de", "fr"]);
  });

  it("keeps non-ru targets when source is ru", () => {
    expect(sanitizePostFillLocales("ru", ["en", "de", "ru"])).toEqual(["en", "de"]);
  });
});
