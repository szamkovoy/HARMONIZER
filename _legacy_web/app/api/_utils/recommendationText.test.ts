import { describe, expect, it } from "vitest";

import {
  normalizeLongExplanationSectionHeaders,
  normalizeRecommendationText,
  normalizeTechnicalTermsInText,
} from "./recommendationText";

describe("normalizeTechnicalTermsInText", () => {
  it("replaces quoted English tone keys in Russian copy", () => {
    const input =
      "Юпитер задаёт тему с тоном «harmonic» и гравитацией 0.821, а Луна — «ambivalent_strong».";
    const output = normalizeTechnicalTermsInText(input, "ru");
    expect(output).toContain("«гармоничный»");
    expect(output).toContain("«сильная двойственность»");
    expect(output).not.toMatch(/harmonic|ambivalent_strong/i);
  });
});

describe("normalizeLongExplanationSectionHeaders", () => {
  it("shortens the Russian section 6 heading", () => {
    const input = "§6. ЗАКЛЮЧЕНИЕ С МОСТИКОМ (~150 знаков):";
    expect(normalizeLongExplanationSectionHeaders(input)).toBe("§6. ЗАКЛЮЧЕНИЕ (~150 знаков):");
  });
});

describe("normalizeRecommendationText", () => {
  it("applies tone and header normalization together", () => {
    const input = "§6. ЗАКЛЮЧЕНИЕ С МОСТИКОМ\nТон harmonic.";
    const output = normalizeRecommendationText(input, "ru");
    expect(output).toContain("§6. ЗАКЛЮЧЕНИЕ");
    expect(output).toContain("гармоничный");
    expect(output).not.toMatch(/harmonic|мостиком/i);
  });
});
