import type { AppLocale } from "@/modules/i18n/localeStore";
import { asContentLocale } from "@/modules/i18n/localeCodes";

export type VoiceTurnLocaleParams = {
  detectedLanguage?: string | null;
  responseLocale: AppLocale;
  testMode: boolean;
};

export type VoiceTurnLocaleDecision = {
  detectedInputLocale?: AppLocale;
  responseLocale: AppLocale;
};

/**
 * Voice STT may report raw values like `it`, `it-IT`, or an unsupported language.
 * Only supported app locales are allowed to override the assistant reply locale;
 * otherwise the dialog stays on the currently selected app locale.
 */
export function resolveVoiceTurnLocales(params: VoiceTurnLocaleParams): VoiceTurnLocaleDecision {
  const detectedInputLocale = asContentLocale(params.detectedLanguage ?? undefined) ?? undefined;
  return {
    detectedInputLocale,
    responseLocale:
      !params.testMode && detectedInputLocale
        ? detectedInputLocale
        : params.responseLocale,
  };
}
