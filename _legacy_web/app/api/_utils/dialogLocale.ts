/**
 * Dialog response-locale resolution — re-exports from contentLocales.ts.
 * @see contentLocales.ts for layer B (all 8) vs layer C (ru/en scaffold) split.
 */
export {
  ALL_CONTENT_LOCALES,
  LANGUAGE_NAMES,
  SOURCE_LOCALE,
  TARGET_LOCALES,
  asContentLocale,
  asDialogScaffoldLocale,
  languageNameFor,
  localePrefix,
  localeToLanguageName,
  resolveContentLocale,
  resolveDialogScaffoldLocale,
  resolveResponseLocale,
  type AppContentLocale,
  type DialogScaffoldLocale,
  type ResponseLocale,
  type TargetLocale,
} from "./contentLocales";
