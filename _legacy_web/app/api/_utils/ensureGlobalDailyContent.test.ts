import { describe, expect, it } from "vitest";

import { globalContentNeedsRefresh } from "./ensureGlobalDailyContent";

function buildStructuredLongExplanation(): string {
  return [
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
}

describe("globalContentNeedsRefresh", () => {
  it("keeps a current structured row", () => {
    expect(
      globalContentNeedsRefresh(
        {
          llm_model: "gemini-test",
          slogan: "Импульс дня",
          short_text: "Короткий текст",
          long_explanation: buildStructuredLongExplanation(),
          math_level: {
            structured: {
              schema_version: 2,
              chart_mode: "transit_only",
              planet_positions: {},
              main_aspects: [],
              planet_scores: [],
            },
          },
        },
        "gemini-test",
      ),
    ).toBe(false);
  });

  it("forces refresh for legacy unstructured long explanation", () => {
    expect(
      globalContentNeedsRefresh(
        {
          llm_model: "gemini-test",
          slogan: "Импульс дня",
          short_text: "Короткий текст",
          long_explanation: "Марс задаёт тон дня, а Луна смягчает его без секций.",
          math_level: {
            structured: {
              schema_version: 2,
              chart_mode: "transit_only",
              planet_positions: {},
              main_aspects: [],
              planet_scores: [],
            },
          },
        },
        "gemini-test",
      ),
    ).toBe(true);
  });
});
