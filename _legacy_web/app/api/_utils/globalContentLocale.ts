import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppContentLocale } from "./contentLocales";
import { SOURCE_LOCALE } from "./contentLocales";
import { buildGlobalMathLevel } from "./globalTransitMath";
import { pickGlobalTexts, pretranslateGlobalTexts, upsertGlobalTextI18n, type GlobalTextFields } from "./pretranslateGlobalTexts";

type GlobalContentRow = {
  slogan?: unknown;
  short_text?: unknown;
  long_explanation?: unknown;
  math_level?: unknown;
  top_petals?: unknown;
  planet_positions?: unknown;
  text_i18n?: unknown;
};

type LocalizedGlobalPayload = GlobalTextFields & {
  math_level: ReturnType<typeof buildGlobalMathLevel>;
};

function rebuildGlobalMathLevel(content: GlobalContentRow, locale: AppContentLocale): ReturnType<typeof buildGlobalMathLevel> {
  const structured = (content.math_level as { structured?: Record<string, unknown> } | undefined)?.structured;
  const topPetals =
    (structured?.top_petals as { planet: string; gravity: number; chakra_number: number; tone: string }[] | undefined) ??
    (content.top_petals as { planet: string; gravity: number; chakra_number: number; tone: string }[] | undefined) ??
    [];
  const aspects =
    (structured?.aspects as { from: string; to: string; type: string; orb: number }[] | undefined) ?? [];
  const planetPositions =
    (structured?.planet_positions as Record<string, unknown> | undefined) ??
    (content.planet_positions as Record<string, unknown> | undefined) ??
    {};
  return buildGlobalMathLevel({ top_petals: topPetals, aspects, planet_positions: planetPositions }, locale);
}

/**
 * After canonical RU row is written, pre-translate slogan/short/long for all target locales.
 */
export async function ensureGlobalTextI18nPrecomputed(
  db: SupabaseClient,
  forecastDateUtc: string,
  ru: GlobalTextFields,
): Promise<void> {
  const textI18n = await pretranslateGlobalTexts(ru);
  await upsertGlobalTextI18n(db, forecastDateUtc, textI18n);
}

export function localizeGlobalContentPayloadSync(
  content: GlobalContentRow,
  locale: AppContentLocale,
): LocalizedGlobalPayload {
  const texts = pickGlobalTexts(content, locale);
  return {
    ...texts,
    math_level: rebuildGlobalMathLevel(content, locale),
  };
}

/** @deprecated userId kept for API compatibility; reads text_i18n first. */
export async function localizeGlobalContentPayload(
  db: SupabaseClient,
  _userId: string,
  forecastDateUtc: string,
  content: GlobalContentRow,
  locale: AppContentLocale,
): Promise<LocalizedGlobalPayload> {
  void db;
  void forecastDateUtc;
  return localizeGlobalContentPayloadSync(content, locale);
}
