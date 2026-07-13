import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppContentLocale } from "./contentLocales";
import { SOURCE_LOCALE, TARGET_LOCALES, asContentLocale, type TargetLocale } from "./contentLocales";
import { isCurrentGlobalLongExplanation, normalizeRecommendationText } from "./recommendationText";
import { buildGlobalMathLevel } from "./globalTransitMath";
import { pickGlobalTexts, pretranslateGlobalTexts, upsertGlobalTextI18n, type GlobalTextFields } from "./pretranslateGlobalTexts";

type GlobalContentRow = {
  slogan?: unknown;
  short_text?: unknown;
  long_explanation?: unknown;
  math_level?: unknown;
  primary_planet?: unknown;
  primary_chakra_number?: unknown;
  primary_tone?: unknown;
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
    (structured?.aspects as { from: string; to: string; type: string; orb: number; maxOrb: number }[] | undefined) ?? [];
  const planetScores =
    (structured?.planet_scores as
      | {
          planet: string;
          gravity: number;
          chakra_number: number;
          tone: string;
          sign?: string;
          sign_degree?: number;
        }[]
      | undefined) ?? [];
  const planetPositions =
    (structured?.planet_positions as Record<string, unknown> | undefined) ??
    (content.planet_positions as Record<string, unknown> | undefined) ??
    {};
  return buildGlobalMathLevel(
    {
      top_petals: topPetals,
      aspects,
      planet_positions: planetPositions,
      primary_planet: typeof content.primary_planet === "string" ? content.primary_planet : undefined,
      primary_chakra_number:
        typeof content.primary_chakra_number === "number" ? content.primary_chakra_number : undefined,
      primary_tone: typeof content.primary_tone === "string" ? content.primary_tone : undefined,
      planet_scores: planetScores,
    },
    locale,
  );
}

/**
 * Target locales that at least one user currently uses (for free-tier cron pretranslate).
 * Skips unused languages — on-demand `global-content` still backfills a missing locale.
 */
export async function listActiveTargetLocales(db: SupabaseClient): Promise<TargetLocale[]> {
  const { data, error } = await db.from("users").select("locale");
  if (error || !data?.length) return [...TARGET_LOCALES];
  const active = new Set<TargetLocale>();
  for (const row of data) {
    const locale = asContentLocale((row as { locale?: string | null }).locale);
    if (locale && locale !== SOURCE_LOCALE) {
      active.add(locale as TargetLocale);
    }
  }
  return active.size > 0 ? [...active] : [...TARGET_LOCALES];
}

/**
 * After canonical RU row is written, pre-translate slogan/short/long for active user locales.
 */
export async function ensureGlobalTextI18nPrecomputed(
  db: SupabaseClient,
  forecastDateUtc: string,
  ru: GlobalTextFields,
): Promise<void> {
  const locales = await listActiveTargetLocales(db);
  const textI18n = await pretranslateGlobalTexts(ru, { locales });
  await upsertGlobalTextI18n(db, forecastDateUtc, textI18n);
}

export function localizeGlobalContentPayloadSync(
  content: GlobalContentRow,
  locale: AppContentLocale,
): LocalizedGlobalPayload {
  const texts = pickGlobalTexts(content, locale);
  const normalizedLongExplanation = normalizeRecommendationText(texts.long_explanation, locale);
  return {
    slogan: normalizeRecommendationText(texts.slogan, locale),
    short_text: normalizeRecommendationText(texts.short_text, locale),
    long_explanation: isCurrentGlobalLongExplanation(normalizedLongExplanation) ? normalizedLongExplanation : "",
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
