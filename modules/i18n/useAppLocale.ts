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
  /** Default STT/input locale. Voice turns may still auto-detect per turn. */
  transcribeLocale: AppLocale;
  /** Whether speech-driven reply-language test mode is on. */
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
