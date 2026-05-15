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
      modelCardBlurb: null,
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
      modelCardBlurb: null,
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
      modelCardBlurb: null,
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
      modelCardBlurb: null,
    });
    expect(s.toLowerCase()).toContain("coherent");
  });

  it("prefers validated model card blurb when present", () => {
    const s = buildPracticeCardSummary({
      kind: "breath",
      slug: "coherent",
      chakraIds: [4],
      locale: "ru",
      userMessage: "тревога",
      modelCardBlurb:
        "Когерентное дыхание мягко выравнивает внутренний ритм и помогает вернуть опору, когда день разбрасывает внимание. Выполняя эту практику, удерживайте внимание на ясности, собранности и внутренней тишине. Если вы владеете пранаямой, дышите через Анахату.",
    });
    expect(s).toContain("Если вы владеете пранаямой");
    expect(s).toContain("ясности, собранности");
  });

  it("rejects invalid model blurb with HTML and falls back to server summary", () => {
    const s = buildPracticeCardSummary({
      kind: "breath",
      slug: "coherent",
      chakraIds: [4],
      locale: "ru",
      userMessage: "тревога",
      modelCardBlurb:
        '<b>Когерентное дыхание</b> помогает успокоиться и собраться. Выполняя эту практику, удерживайте внимание на ясности, мягкости и устойчивости. Если вы владеете пранаямой, дышите через Анахату.',
    });
    expect(s).toContain("Когерентное");
    expect(s).not.toContain("<b>");
  });
});
