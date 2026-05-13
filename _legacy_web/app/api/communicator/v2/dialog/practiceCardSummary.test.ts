import { describe, expect, it } from "vitest";

import { buildPracticeCardSummary } from "./practiceCardSummary";

describe("buildPracticeCardSummary", () => {
  it("yoga: mentions chakras and body work (ru)", () => {
    const s = buildPracticeCardSummary({
      kind: "yoga",
      slug: "any",
      chakraIds: [5, 4],
      locale: "ru",
      userMessage: "Волнует разговор с шефом",
    });
    expect(s).toContain("Вишуддха");
    expect(s).toContain("Анахата");
    expect(s).toContain("асан");
  });

  it("meditation: short supportive text (ru)", () => {
    const s = buildPracticeCardSummary({
      kind: "meditation",
      slug: "sacred-symbol-stream",
      chakraIds: [6, 7],
      locale: "ru",
      userMessage: "усталость",
    });
    expect(s).toContain("медитац");
    expect(s).not.toContain("«усталость»");
  });

  it("breath: uses slug-specific blurb (coherent, ru)", () => {
    const s = buildPracticeCardSummary({
      kind: "breath",
      slug: "coherent",
      chakraIds: [4],
      locale: "ru",
      userMessage: "тревога",
    });
    expect(s).toContain("Когерентное");
    expect(s).not.toMatch(/Рядом с вашим|запросом/i);
  });

  it("breath: falls back for unknown slug (en)", () => {
    const s = buildPracticeCardSummary({
      kind: "breath",
      slug: "unknown-slug",
      chakraIds: [],
      locale: "en",
      userMessage: "stress",
    });
    expect(s.toLowerCase()).toContain("coherent");
  });
});
