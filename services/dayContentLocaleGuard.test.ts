import { describe, expect, it } from "vitest";

import { assertDayTextsMatchLocale, textLooksLikeRussian } from "@/services/dayContentLocaleGuard";

describe("dayContentLocaleGuard", () => {
  it("detects Cyrillic-heavy Russian copy", () => {
    expect(textLooksLikeRussian("Разрешите телу желать без оглядки")).toBe(true);
    expect(textLooksLikeRussian("Архетип Венеры — это чувственная жизнь, текучая и отзывчивая.")).toBe(true);
    expect(textLooksLikeRussian("Позвольте телу наслаждаться без условий")).toBe(true);
    expect(
      textLooksLikeRussian(
        "Сегодня в центре — Архетип Любовницы, чья суть в живом, пульсирующем удовольствии от самого существования.",
      ),
    ).toBe(true);
  });

  it("accepts English and German copy", () => {
    expect(textLooksLikeRussian("Allow the body to desire without looking back")).toBe(false);
    expect(textLooksLikeRussian("Lassen Sie den Körper ohne Zurückblicken begehren")).toBe(false);
  });

  it("rejects Russian texts for non-RU locales", () => {
    expect(() =>
      assertDayTextsMatchLocale(
        "en",
        "Разрешите телу желать без оглядки",
        "Архетип Венеры — это чувственная жизнь",
      ),
    ).toThrow(/language mismatch/);
    expect(() =>
      assertDayTextsMatchLocale("en", "Let pleasure lead today", "Venus invites soft attention"),
    ).not.toThrow();
  });
});
