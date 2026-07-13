import type { SupabaseClient } from "@supabase/supabase-js";

import { generateGeminiJson, getModelByHint } from "./gemini";
import {
  languageNameFor,
  SOURCE_LOCALE,
  TARGET_LOCALES,
  type AppContentLocale,
  type TargetLocale,
} from "./contentLocales";

export type GlobalTextFields = {
  slogan: string;
  short_text: string;
  long_explanation: string;
};

export type GlobalTextI18nMap = Partial<Record<TargetLocale, GlobalTextFields>>;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function translateFields(from: GlobalTextFields, locale: TargetLocale): Promise<GlobalTextFields> {
  const languageName = languageNameFor(locale);
  const result = await generateGeminiJson<GlobalTextFields>({
    prompt: [
      `Translate the following daily forecast texts from Russian into ${languageName}.`,
      "Preserve an empathetic mentor tone suitable for a yoga + psychology app.",
      "Return JSON with keys slogan, short_text, long_explanation only.",
      "Do not leave any Russian/Cyrillic in the output.",
      "",
      JSON.stringify(from, null, 2),
    ].join("\n"),
    model: getModelByHint("standard"),
    temperature: 0.3,
    maxOutputTokens: 6144,
  });

  return {
    slogan: asString(result.json.slogan) || from.slogan,
    short_text: asString(result.json.short_text) || from.short_text,
    long_explanation: asString(result.json.long_explanation) || from.long_explanation,
  };
}

/**
 * Translate RU (or wrong-language) morning slogan/short/long into a target locale.
 * Used as a last-resort fallback when the monologue LLM ignores OUTPUT LANGUAGE.
 */
export async function translateMorningTextFields(
  from: GlobalTextFields,
  locale: AppContentLocale,
): Promise<GlobalTextFields> {
  if (locale === SOURCE_LOCALE) {
    return {
      slogan: asString(from.slogan),
      short_text: asString(from.short_text),
      long_explanation: asString(from.long_explanation),
    };
  }
  return translateFields(from, locale as TargetLocale);
}

/**
 * Pre-translate canonical RU global texts into every target locale.
 * Used by cron / ensureGlobalDailyContentRow so free-tier users get instant localized copy.
 */
export async function pretranslateGlobalTexts(
  ru: GlobalTextFields,
  opts?: { locales?: readonly TargetLocale[] },
): Promise<GlobalTextI18nMap> {
  const source: GlobalTextFields = {
    slogan: asString(ru.slogan),
    short_text: asString(ru.short_text),
    long_explanation: asString(ru.long_explanation),
  };
  if (!source.slogan || !source.short_text) {
    return {};
  }

  const locales = opts?.locales ?? TARGET_LOCALES;
  const out: GlobalTextI18nMap = {};

  for (const locale of locales) {
    try {
      out[locale] = await translateFields(source, locale);
    } catch (error) {
      console.error("[pretranslateGlobalTexts] locale failed", locale, error);
    }
  }

  return out;
}

export function pickGlobalTexts(
  row: {
    slogan?: unknown;
    short_text?: unknown;
    long_explanation?: unknown;
    text_i18n?: unknown;
  },
  locale: AppContentLocale,
): GlobalTextFields {
  const ru: GlobalTextFields = {
    slogan: asString(row.slogan),
    short_text: asString(row.short_text),
    long_explanation: asString(row.long_explanation),
  };
  if (locale === SOURCE_LOCALE) return ru;

  const map = row.text_i18n as GlobalTextI18nMap | undefined;
  const localized = map?.[locale as TargetLocale];
  if (localized?.slogan && localized?.short_text) {
    return {
      slogan: asString(localized.slogan),
      short_text: asString(localized.short_text),
      long_explanation: asString(localized.long_explanation) || ru.long_explanation,
    };
  }

  return ru;
}

export async function upsertGlobalTextI18n(
  db: SupabaseClient,
  forecastDateUtc: string,
  textI18n: GlobalTextI18nMap,
): Promise<void> {
  if (!Object.keys(textI18n).length) return;
  const { error } = await db
    .from("global_daily_content")
    .update({ text_i18n: textI18n })
    .eq("forecast_date_utc", forecastDateUtc);
  if (error) throw error;
}
