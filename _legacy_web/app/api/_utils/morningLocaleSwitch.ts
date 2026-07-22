import type { SupabaseClient } from "@supabase/supabase-js";

import { asContentLocale, type AppContentLocale } from "./contentLocales";
import {
  morningTextsMatchLocale,
  MORNING_CACHE_OUTPUT_LOCALE_KEY,
  textLooksLikeRussian,
} from "./outputLanguagePrompt";
import { translateMorningTextFields, type GlobalTextFields } from "./pretranslateGlobalTexts";
import { getUserTimezone, todayLocalDate } from "../calibration/extract/forecast-cache-date";

/** Canonical LLM texts that later locale-switch translations must use as input. */
export const MORNING_SOURCE_TEXTS_KEY = "sourceTexts";
export const MORNING_SOURCE_LOCALE_KEY = "sourceLocale";
/** `"generated"` = big-prompt output; `"translated"` = locale-switch copy. */
export const MORNING_GENERATION_MODE_KEY = "generationMode";

export type MorningTextFields = GlobalTextFields;

export type MorningSourceMaterial = {
  texts: MorningTextFields;
  sourceLocale: AppContentLocale;
  math_level: unknown | null;
  modelUsed: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readMorningTextFields(value: unknown): MorningTextFields | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const slogan = asString(row.slogan);
  const short_text = asString(row.short_text);
  const long_explanation = asString(row.long_explanation);
  if (!slogan || !short_text) return null;
  return { slogan, short_text, long_explanation };
}

/** Infer a plausible source locale for legacy rows that lack `sourceLocale`. */
export function inferMorningSourceLocale(
  texts: MorningTextFields,
  fallback: AppContentLocale,
): AppContentLocale {
  if (textLooksLikeRussian(texts.slogan) || textLooksLikeRussian(texts.short_text)) {
    return "ru";
  }
  return fallback;
}

/**
 * Prefer embedded canonical sourceTexts; otherwise treat the row itself as source
 * (legacy generated rows before sourceTexts existed).
 */
export function extractSourceMaterial(
  cached: Record<string, unknown>,
): MorningSourceMaterial | null {
  const embedded = readMorningTextFields(cached[MORNING_SOURCE_TEXTS_KEY]);
  const embeddedLocale = asContentLocale(asString(cached[MORNING_SOURCE_LOCALE_KEY]));
  if (embedded && embeddedLocale) {
    return {
      texts: embedded,
      sourceLocale: embeddedLocale,
      math_level: cached.math_level ?? null,
      modelUsed: typeof cached.modelUsed === "string" ? cached.modelUsed : null,
    };
  }

  const texts = readMorningTextFields(cached);
  if (!texts) return null;
  const outputLocale = asContentLocale(asString(cached[MORNING_CACHE_OUTPUT_LOCALE_KEY]));
  const sourceLocale = inferMorningSourceLocale(texts, outputLocale ?? "en");
  return {
    texts,
    sourceLocale,
    math_level: cached.math_level ?? null,
    modelUsed: typeof cached.modelUsed === "string" ? cached.modelUsed : null,
  };
}

type MorningCacheRow = {
  locale: AppContentLocale;
  data: Record<string, unknown>;
};

/**
 * Pick the best canonical source for locale-switch translation.
 *
 * Priority (high → low):
 * 1. `"generated"` row that is self-canonical (`sourceLocale === row.locale`),
 *    preferring Russian (authoring default);
 * 2. any other `"generated"` row;
 * 3. any row with usable texts (including translated — last resort; do not
 *    chase a missing “original” forever).
 *
 * Important: do **not** prefer the first row that merely has `sourceTexts`.
 * A wrongly full-generated FR row can carry `sourceTexts=fr` and would otherwise
 * beat a real RU generated cache (FR→RU overwrite bug).
 */
export function pickBestMorningSource(rows: MorningCacheRow[]): MorningSourceMaterial | null {
  if (!rows.length) return null;

  type Ranked = { score: number; material: MorningSourceMaterial };
  const ranked: Ranked[] = [];

  for (const row of rows) {
    const material = extractSourceMaterial(row.data);
    if (!material) continue;
    const mode = asString(row.data[MORNING_GENERATION_MODE_KEY]);
    let score = 0;
    if (mode === "generated" && material.sourceLocale === row.locale) {
      score += 100;
    } else if (mode === "generated") {
      score += 80;
    } else if (mode === "translated") {
      score += 10;
    } else {
      score += 20; // legacy row without generationMode
    }
    if (material.sourceLocale === "ru") score += 25;
    if (row.locale === "ru") score += 5;
    ranked.push({ score, material });
  }

  if (!ranked.length) return null;
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]!.material;
}

export async function listMorningCachesForToday(
  db: SupabaseClient,
  userId: string,
): Promise<MorningCacheRow[]> {
  const userTz = await getUserTimezone(db, userId);
  const date = todayLocalDate(userTz);
  const prefix = `morning_recommendation:${userId}:${date}:`;
  const { data, error } = await db
    .from("scenario_cache")
    .select("cache_key, data")
    .like("cache_key", `${prefix}%`);
  if (error) throw error;

  const out: MorningCacheRow[] = [];
  for (const row of data ?? []) {
    const key = asString((row as { cache_key?: unknown }).cache_key);
    const locale = asContentLocale(key.slice(prefix.length));
    const payload = (row as { data?: unknown }).data;
    if (!locale || !payload || typeof payload !== "object") continue;
    out.push({ locale, data: payload as Record<string, unknown> });
  }
  return out;
}

export function withMorningSourceMeta(
  payload: Record<string, unknown>,
  opts: {
    outputLocale: AppContentLocale;
    sourceLocale: AppContentLocale;
    sourceTexts: MorningTextFields;
    generationMode: "generated" | "translated";
  },
): Record<string, unknown> {
  return {
    ...payload,
    [MORNING_CACHE_OUTPUT_LOCALE_KEY]: opts.outputLocale,
    [MORNING_SOURCE_LOCALE_KEY]: opts.sourceLocale,
    [MORNING_SOURCE_TEXTS_KEY]: opts.sourceTexts,
    [MORNING_GENERATION_MODE_KEY]: opts.generationMode,
  };
}

/**
 * Fast locale-switch path: translate canonical source texts into `targetLocale`.
 * Throws if no morning cache exists for today (caller should fall back to full generate).
 */
export type MorningLocaleSwitchResult = {
  slogan: string;
  short_text: string;
  long_explanation: string;
  math_level: unknown | null;
  modelUsed: string | null;
  sourceLocale: AppContentLocale;
  sourceTexts: MorningTextFields;
  /** True when the target-locale row was already valid — do not rewrite cache meta. */
  servedExistingTarget: boolean;
  generationMode: "generated" | "translated";
};

export async function translateMorningFromCachedSource(params: {
  db: SupabaseClient;
  userId: string;
  targetLocale: AppContentLocale;
}): Promise<MorningLocaleSwitchResult> {
  const rows = await listMorningCachesForToday(params.db, params.userId);

  // Target locale already has a valid morning cache — return it as-is.
  // Do not re-translate and overwrite (e.g. FR→RU when RU warm already exists).
  const targetRow = rows.find((row) => row.locale === params.targetLocale);
  if (targetRow) {
    const targetTexts = readMorningTextFields(targetRow.data);
    if (
      targetTexts
      && morningTextsMatchLocale(params.targetLocale, targetTexts.slogan, targetTexts.short_text)
    ) {
      const material = extractSourceMaterial(targetRow.data);
      const mode = asString(targetRow.data[MORNING_GENERATION_MODE_KEY]);
      return {
        slogan: targetTexts.slogan,
        short_text: targetTexts.short_text,
        long_explanation: targetTexts.long_explanation,
        math_level: targetRow.data.math_level ?? material?.math_level ?? null,
        modelUsed:
          typeof targetRow.data.modelUsed === "string"
            ? targetRow.data.modelUsed
            : (material?.modelUsed ?? null),
        sourceLocale: material?.sourceLocale ?? params.targetLocale,
        sourceTexts: material?.texts ?? targetTexts,
        servedExistingTarget: true,
        generationMode: mode === "generated" ? "generated" : "translated",
      };
    }
  }

  const source = pickBestMorningSource(rows);
  if (!source) {
    throw new Error("No morning source texts available for locale switch");
  }

  if (params.targetLocale === source.sourceLocale) {
    return {
      slogan: source.texts.slogan,
      short_text: source.texts.short_text,
      long_explanation: source.texts.long_explanation,
      math_level: source.math_level,
      modelUsed: source.modelUsed,
      sourceLocale: source.sourceLocale,
      sourceTexts: source.texts,
      servedExistingTarget: false,
      generationMode: "generated",
    };
  }

  const translated = await translateMorningTextFields(
    source.texts,
    params.targetLocale,
    source.sourceLocale,
  );
  if (
    !morningTextsMatchLocale(params.targetLocale, translated.slogan, translated.short_text)
  ) {
    throw new Error(`Locale-switch translation mismatch for locale=${params.targetLocale}`);
  }

  return {
    slogan: translated.slogan,
    short_text: translated.short_text,
    long_explanation: translated.long_explanation,
    math_level: source.math_level,
    modelUsed: source.modelUsed,
    sourceLocale: source.sourceLocale,
    sourceTexts: source.texts,
    servedExistingTarget: false,
    generationMode: "translated",
  };
}
