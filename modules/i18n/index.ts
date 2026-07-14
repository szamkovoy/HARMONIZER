export {
  APP_LOCALE_OPTIONS,
  DEFAULT_APP_LOCALE,
  I18N_TEST_MODE,
  coerceAppLocale,
  getAppLocale,
  getResponseLocale,
  getTranscribeLocale,
  hydrateAppLocale,
  setAppLocale,
  subscribeAppLocale,
  type AppLocale,
  type AppLocaleOption,
} from "@/modules/i18n/localeStore";
export { useAppLocale, type UseAppLocaleResult } from "@/modules/i18n/useAppLocale";
export { t, tCount, pluralCategory } from "@/modules/i18n/t";
export {
  ALL_CONTENT_LOCALES,
  LANGUAGE_NAMES,
  SOURCE_LOCALE,
  TARGET_LOCALES,
  asContentLocale,
  languageNameFor,
  type AppContentLocale,
} from "@/modules/i18n/localeCodes";
export { mergeTypedLocale, applyFlatChakraOverlay } from "@/modules/i18n/typed/merge";
export {
  parseStringRecord,
  pickLocalizedText,
  pickLocalizedTextOrNull,
  pickLocalizedUrl,
  pickExactLocalizedText,
  pickExactLocalizedTextOrNull,
  pickExactLocalizedUrl,
  hasLocalizedTitle,
  hasExactLocalizedTitle,
} from "@/modules/i18n/pickLocalizedContent";
export { useTranslate } from "@/modules/i18n/useTranslate";
export { formatRelativeTime } from "@/modules/i18n/formatRelativeTime";
