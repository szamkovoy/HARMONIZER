import { describe, expect, it } from "vitest";

import { resolveVoiceTurnLocales } from "./voiceTurnLocale";

describe("resolveVoiceTurnLocales", () => {
  it("uses a supported detected locale outside test mode", () => {
    expect(
      resolveVoiceTurnLocales({
        detectedLanguage: "it-IT",
        responseLocale: "fr",
        testMode: false,
      }),
    ).toEqual({
      detectedInputLocale: "it",
      responseLocale: "it",
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

  it("keeps the selected response locale in i18n test mode", () => {
    expect(
      resolveVoiceTurnLocales({
        detectedLanguage: "ru",
        responseLocale: "it",
        testMode: true,
      }),
    ).toEqual({
      detectedInputLocale: "ru",
      responseLocale: "it",
    });
  });
});
