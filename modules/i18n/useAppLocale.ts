import { useSyncExternalStore } from "react";

import {
  getAppLocale,
  getTranscribeLocale,
  I18N_TEST_MODE,
  setAppLocale,
  subscribeAppLocale,
  type AppLocale,
} from "@/modules/i18n/localeStore";

export interface UseAppLocaleResult {
  /** Active UI + response locale. */
  locale: AppLocale;
  /** STT language (stays "ru" in test mode). */
  transcribeLocale: AppLocale;
  /** Whether RU-input / other-language-output test mode is on. */
  testMode: boolean;
  setLocale: (locale: AppLocale) => void;
}

export function useAppLocale(): UseAppLocaleResult {
  const locale = useSyncExternalStore(subscribeAppLocale, getAppLocale, getAppLocale);
  return {
    locale,
    transcribeLocale: getTranscribeLocale(),
    testMode: I18N_TEST_MODE,
    setLocale: (next: AppLocale) => {
      void setAppLocale(next);
    },
  };
}
