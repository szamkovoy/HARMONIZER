import { describe, expect, it } from "vitest";

import {
  hasLegacyGlobalChakraMentions,
  hasStructuredGlobalLongExplanation,
  isCurrentGlobalLongExplanation,
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

describe("isCurrentGlobalLongExplanation", () => {
  const structuredText = [
    "§1. ОБЩАЯ КАРТИНА ДНЯ",
    "Три планеты формируют ритм дня.",
    "§2. ГЛАВНАЯ ТЕМА",
    "Юпитер задаёт стержень и опирается на аспект дня.",
    "§3. ВТОРОЙ ЛЕПЕСТОК",
    "Луна смягчает основной тон.",
    "§4. ТРЕТИЙ ЛЕПЕСТОК",
    "Марс добавляет направление и волю.",
    "§5. КОНЦЕПТУАЛЬНАЯ ОПОРА",
    "Это напоминает классическую логику аспектов.",
    "§6. ЗАКЛЮЧЕНИЕ",
    "Соберите это в одну мысль и перейдите к расчётам.",
  ].join("\n\n");

  it("accepts structured six-section copy without chakra language", () => {
    expect(hasStructuredGlobalLongExplanation(structuredText)).toBe(true);
    expect(hasLegacyGlobalChakraMentions(structuredText)).toBe(false);
    expect(isCurrentGlobalLongExplanation(structuredText)).toBe(true);
  });

  it("rejects legacy free-tier copy with chakra wording", () => {
    const legacyText = `${structuredText}\n\nМарс действует из третьей чакры и усиливает Манипуру.`;
    expect(hasLegacyGlobalChakraMentions(legacyText)).toBe(true);
    expect(isCurrentGlobalLongExplanation(legacyText)).toBe(false);
  });

  it("rejects unstructured copy even after header normalization", () => {
    const unstructured = "Марс задаёт ритм дня, а Луна поддерживает его без явных секций.";
    expect(hasStructuredGlobalLongExplanation(unstructured)).toBe(false);
    expect(isCurrentGlobalLongExplanation(unstructured)).toBe(false);
  });
});
