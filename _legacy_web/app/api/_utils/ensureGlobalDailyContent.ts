import type { SupabaseClient } from "@supabase/supabase-js";

import { buildGlobalMathLevel, computeGlobalDailyForecast, isGlobalMathLevelCurrent } from "./globalTransitMath";
import { isCurrentGlobalLongExplanation, normalizeRecommendationFields } from "./recommendationText";
import { ensureGlobalTextI18nPrecomputed } from "./globalContentLocale";
import { generateGeminiJson, getModelByHint } from "./gemini";
import { getActivePrompt, renderPrompt } from "./prompts";

function calcExpiresAt(forecastDateUtc: string): string {
  const date = new Date(`${forecastDateUtc}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(14, 0, 0, 0);
  return date.toISOString();
}

const GLOBAL_PROMPT_KEY = "global_morning_recommendation";
/** Cyrillic JSON + three fields need headroom; DB prompt may still say 2200. */
const GLOBAL_LLM_MIN_OUTPUT_TOKENS = 6144;

function hasRequiredText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function globalContentNeedsRefresh(existing: Record<string, unknown> | null | undefined, expectedModel: string): boolean {
  if (!existing) return true;
  const existingModel = typeof existing.llm_model === "string" ? existing.llm_model.trim() : "";
  if (!existingModel || existingModel !== expectedModel) return true;
  if (!hasRequiredText(existing.slogan)) return true;
  if (!hasRequiredText(existing.short_text)) return true;
  if (!hasRequiredText(existing.long_explanation)) return true;
  if (!isCurrentGlobalLongExplanation(existing.long_explanation)) return true;
  if (!isGlobalMathLevelCurrent(existing.math_level)) return true;
  return false;
}

export async function getExpectedGlobalDailyContentModel(db: SupabaseClient): Promise<string> {
  const prompt = await getActivePrompt(db, GLOBAL_PROMPT_KEY);
  return getModelByHint(prompt.model_hint);
}

/**
 * Если в `global_daily_content` нет строки на дату — считаем эфемериды, зовём Gemini,
 * upsert в БД (идемпотентно при гонках).
 */
export async function ensureGlobalDailyContentRow(db: SupabaseClient, forecastDateUtc: string): Promise<void> {
  const forecast = computeGlobalDailyForecast(forecastDateUtc);
  const mathLevel = buildGlobalMathLevel(forecast);
  const prompt = await getActivePrompt(db, GLOBAL_PROMPT_KEY);

  const maxOut = Math.max(prompt.max_output_tokens ?? 2200, GLOBAL_LLM_MIN_OUTPUT_TOKENS);
  const result = await generateGeminiJson<{
    slogan?: string;
    short_text?: string;
    long_explanation?: string;
  }>({
    prompt: renderPrompt(prompt.template, {
      top_petals_json: JSON.stringify(forecast.top_petals, null, 2),
      aspects_json: JSON.stringify(forecast.aspects, null, 2),
    }),
    model: getModelByHint(prompt.model_hint),
    temperature: prompt.temperature ?? 0.85,
    maxOutputTokens: maxOut,
  });

  const row = normalizeRecommendationFields({
    forecast_date_utc: forecastDateUtc,
    planet_positions: forecast.planet_positions,
    primary_planet: forecast.primary_planet,
    primary_chakra_number: forecast.primary_chakra_number,
    primary_tone: forecast.primary_tone,
    top_petals: forecast.top_petals,
    slogan: String(result.json.slogan ?? "").trim() || "День приглашает настроиться и двигаться в своём темпе.",
    short_text:
      String(result.json.short_text ?? "").trim() ||
      "Сегодня полезно удерживать внимание на теле и дыхании, не форсируя решения.",
    long_explanation:
      String(result.json.long_explanation ?? "").trim() ||
      "Транзитная картина дня собрана из положений семи классических планет; развёрнутый текст временно короткий — обновите экран позже.",
    math_level: mathLevel,
    generated_at: new Date().toISOString(),
    llm_tokens_used: null as number | null,
    llm_model: result.modelUsed,
    expires_at_utc: calcExpiresAt(forecastDateUtc),
  }, "ru");

  const { error } = await db.from("global_daily_content").upsert(row, { onConflict: "forecast_date_utc" });
  if (error) throw error;

  try {
    await ensureGlobalTextI18nPrecomputed(db, forecastDateUtc, {
      slogan: row.slogan,
      short_text: row.short_text,
      long_explanation: row.long_explanation,
    });
  } catch (pretranslateError) {
    console.error("[ensureGlobalDailyContentRow] text_i18n pretranslate failed", pretranslateError);
  }
}
