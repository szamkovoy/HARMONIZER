import { describe, expect, it } from "vitest";

import {
  extractSourceMaterial,
  inferMorningSourceLocale,
  pickBestMorningSource,
  withMorningSourceMeta,
  MORNING_GENERATION_MODE_KEY,
  MORNING_SOURCE_LOCALE_KEY,
  MORNING_SOURCE_TEXTS_KEY,
} from "./morningLocaleSwitch";
import { MORNING_CACHE_OUTPUT_LOCALE_KEY } from "./outputLanguagePrompt";

describe("morningLocaleSwitch source selection", () => {
  it("prefers explicit sourceTexts over the visible translated row", () => {
    const material = extractSourceMaterial({
      slogan: "Ciao",
      short_text: "Testo italiano abbastanza lungo",
      long_explanation: "Dettaglio",
      [MORNING_CACHE_OUTPUT_LOCALE_KEY]: "it",
      [MORNING_GENERATION_MODE_KEY]: "translated",
      [MORNING_SOURCE_LOCALE_KEY]: "en",
      [MORNING_SOURCE_TEXTS_KEY]: {
        slogan: "Hello morning",
        short_text: "Original English recommendation body here",
        long_explanation: "Long English body",
      },
    });
    expect(material?.sourceLocale).toBe("en");
    expect(material?.texts.slogan).toBe("Hello morning");
  });

  it("infers Russian source for legacy Cyrillic rows", () => {
    const texts = {
      slogan: "Доброе утро для практики",
      short_text: "Сегодня полезно удерживать внимание на теле и дыхании",
      long_explanation: "Подробности",
    };
    expect(inferMorningSourceLocale(texts, "en")).toBe("ru");
  });

  it("picks generated source across locales so IT→DE does not chain through Italian", () => {
    const best = pickBestMorningSource([
      {
        locale: "it",
        data: {
          slogan: "Ciao",
          short_text: "Testo italiano abbastanza lungo per passare heuristic",
          long_explanation: "IT long",
          [MORNING_CACHE_OUTPUT_LOCALE_KEY]: "it",
          [MORNING_GENERATION_MODE_KEY]: "translated",
          [MORNING_SOURCE_LOCALE_KEY]: "en",
          [MORNING_SOURCE_TEXTS_KEY]: {
            slogan: "Hello morning",
            short_text: "Original English recommendation body here",
            long_explanation: "Long English body",
          },
        },
      },
      {
        locale: "en",
        data: {
          slogan: "Hello morning",
          short_text: "Original English recommendation body here",
          long_explanation: "Long English body",
          [MORNING_CACHE_OUTPUT_LOCALE_KEY]: "en",
          [MORNING_GENERATION_MODE_KEY]: "generated",
          [MORNING_SOURCE_LOCALE_KEY]: "en",
          [MORNING_SOURCE_TEXTS_KEY]: {
            slogan: "Hello morning",
            short_text: "Original English recommendation body here",
            long_explanation: "Long English body",
          },
        },
      },
    ]);
    expect(best?.sourceLocale).toBe("en");
    expect(best?.texts.slogan).toBe("Hello morning");
  });

  it("prefers RU generated over a wrongly full-generated FR sourceTexts row", () => {
    const best = pickBestMorningSource([
      {
        locale: "fr",
        data: {
          slogan: "Bonjour le matin",
          short_text: "Recommandation française assez longue pour heuristique",
          long_explanation: "FR long",
          [MORNING_CACHE_OUTPUT_LOCALE_KEY]: "fr",
          [MORNING_GENERATION_MODE_KEY]: "generated",
          [MORNING_SOURCE_LOCALE_KEY]: "fr",
          [MORNING_SOURCE_TEXTS_KEY]: {
            slogan: "Bonjour le matin",
            short_text: "Recommandation française assez longue pour heuristique",
            long_explanation: "FR long",
          },
        },
      },
      {
        locale: "ru",
        data: {
          slogan: "Доброе утро для практики",
          short_text: "Сегодня полезно удерживать внимание на теле и дыхании",
          long_explanation: "RU long",
          [MORNING_CACHE_OUTPUT_LOCALE_KEY]: "ru",
          [MORNING_GENERATION_MODE_KEY]: "generated",
          [MORNING_SOURCE_LOCALE_KEY]: "ru",
          [MORNING_SOURCE_TEXTS_KEY]: {
            slogan: "Доброе утро для практики",
            short_text: "Сегодня полезно удерживать внимание на теле и дыхании",
            long_explanation: "RU long",
          },
        },
      },
    ]);
    expect(best?.sourceLocale).toBe("ru");
    expect(best?.texts.slogan).toBe("Доброе утро для практики");
  });

  it("stores source meta on generated payloads", () => {
    const saved = withMorningSourceMeta(
      {
        slogan: "Hello",
        short_text: "Body",
        long_explanation: "Long",
      },
      {
        outputLocale: "en",
        sourceLocale: "en",
        sourceTexts: {
          slogan: "Hello",
          short_text: "Body",
          long_explanation: "Long",
        },
        generationMode: "generated",
      },
    );
    expect(saved[MORNING_CACHE_OUTPUT_LOCALE_KEY]).toBe("en");
    expect(saved[MORNING_SOURCE_LOCALE_KEY]).toBe("en");
    expect(saved[MORNING_GENERATION_MODE_KEY]).toBe("generated");
  });
});
