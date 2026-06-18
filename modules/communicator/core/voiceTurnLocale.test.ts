import { describe, expect, it } from "vitest";

import { resolveVoiceTurnLocales } from "./voiceTurnLocale";

describe("resolveVoiceTurnLocales", () => {
  it("keeps the selected response locale outside test mode", () => {
    expect(
      resolveVoiceTurnLocales({
        detectedLanguage: "it-IT",
        responseLocale: "fr",
        testMode: false,
      }),
    ).toEqual({
      detectedInputLocale: "it",
      responseLocale: "fr",
    });
  });

  it("keeps the app locale when STT returns an unsupported language", () => {
    expect(
      resolveVoiceTurnLocales({
        detectedLanguage: "uk-UA",
        responseLocale: "fr",
        testMode: false,
      }),
    ).toEqual({
      detectedInputLocale: undefined,
      responseLocale: "fr",
    });
  });

  it("uses the detected speech locale in i18n test mode", () => {
    expect(
      resolveVoiceTurnLocales({
        detectedLanguage: "ru",
        responseLocale: "it",
        testMode: true,
      }),
    ).toEqual({
      detectedInputLocale: "ru",
      responseLocale: "ru",
    });
  });
});
