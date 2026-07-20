import { describe, expect, it } from "vitest";

import {
  isMorningRecommendationCacheValid,
  morningTextsMatchLocale,
  textLooksLikeRussian,
} from "./outputLanguagePrompt";

describe("outputLanguagePrompt locale guard", () => {
  it("detects Cyrillic morning copy", () => {
    expect(textLooksLikeRussian("Разрешите телу желать без оглядки")).toBe(true);
    expect(textLooksLikeRussian("Allow the body to desire without looking back")).toBe(false);
  });

  it("rejects Russian texts for English locale", () => {
    expect(morningTextsMatchLocale("en", "Разрешите телу желать без оглядки", "Архетип Венеры")).toBe(false);
    expect(morningTextsMatchLocale("en", "Let pleasure lead", "Venus invites softness")).toBe(true);
  });

  it("invalidates cached morning rows tagged en but written in Russian", () => {
    expect(
      isMorningRecommendationCacheValid(
        {
          outputLocale: "en",
          slogan: "Разрешите телу желать без оглядки",
          short_text: "Архетип Венеры — это чувственная жизнь",
          math_level: { markdown: "x" },
          modelUsed: "gemini-test",
        },
        "gemini-test",
        "en",
      ),
    ).toBe(false);
  });

  it("serves usable morning cache even when modelUsed differs from current env model", () => {
    expect(
      isMorningRecommendationCacheValid(
        {
          outputLocale: "ru",
          slogan: "Очистите ум от шума для обретения ясности",
          short_text: "Сегодня Меркурий просит ясности в деталях и спокойного внимания.",
          math_level: { markdown: "x" },
          modelUsed: "gemini-3-flash-preview",
        },
        "deepseek-v4-pro",
        "ru",
      ),
    ).toBe(true);
  });
});
