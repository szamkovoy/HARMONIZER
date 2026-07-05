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
  const longExplanation = typeof existing.long_explanation === "string" ? existing.long_explanation : undefined;
  if (!isCurrentGlobalLongExplanation(longExplanation)) return true;
  if (!isGlobalMathLevelCurrent(existing.math_level)) return true;
  return false;
}

export async function getExpectedGlobalDailyContentModel(db: SupabaseClient): Promise<string> {
  const prompt = await getActivePrompt(db, GLOBAL_PROMPT_KEY);
  return getModelByHint(prompt.model_hint);
}

/** Детерминированные тексты-заглушки, когда LLM недоступна. */
const GLOBAL_FALLBACK_SLOGAN = "День приглашает настроиться и двигаться в своём темпе.";
const GLOBAL_FALLBACK_SHORT_TEXT =
  "Сегодня полезно удерживать внимание на теле и дыхании, не форсируя решения.";
const GLOBAL_FALLBACK_LONG_EXPLANATION =
  "Транзитная картина дня собрана из положений семи классических планет; развёрнутый текст временно короткий — обновите экран позже.";

type GlobalLlmTexts = {
  slogan: string;
  short_text: string;
  long_explanation: string;
  modelUsed: string | null;
  isFallback: boolean;
};

/**
 * Пытается сгенерировать тексты через Gemini. При сбое LLM (таймаут, перегрузка,
 * недоступность модели) НЕ бросает, а возвращает детерминированные заглушки с
 * `llm_model = null`, чтобы строка всё равно записалась и free-экран получил
 * структурный прогноз. Пустой `llm_model` держит `globalContentNeedsRefresh`
 * истинным — тексты сами до-генерируются, когда LLM восстановится.
 */
async function generateGlobalTexts(
  db: SupabaseClient,
  forecast: ReturnType<typeof computeGlobalDailyForecast>,
): Promise<GlobalLlmTexts> {
  const prompt = await getActivePrompt(db, GLOBAL_PROMPT_KEY);
  const maxOut = Math.max(prompt.max_output_tokens ?? 2200, GLOBAL_LLM_MIN_OUTPUT_TOKENS);
  try {
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
    return {
      slogan: String(result.json.slogan ?? "").trim() || GLOBAL_FALLBACK_SLOGAN,
      short_text: String(result.json.short_text ?? "").trim() || GLOBAL_FALLBACK_SHORT_TEXT,
      long_explanation: String(result.json.long_explanation ?? "").trim() || GLOBAL_FALLBACK_LONG_EXPLANATION,
      modelUsed: result.modelUsed,
      isFallback: false,
    };
  } catch (llmError) {
    console.error("[ensureGlobalDailyContentRow] LLM generation failed, writing structural fallback row", llmError);
    return {
      slogan: GLOBAL_FALLBACK_SLOGAN,
      short_text: GLOBAL_FALLBACK_SHORT_TEXT,
      long_explanation: GLOBAL_FALLBACK_LONG_EXPLANATION,
      modelUsed: null,
      isFallback: true,
    };
  }
}

/**
 * Если в `global_daily_content` нет строки на дату — считаем эфемериды (детерминированно),
 * пробуем сгенерировать тексты через LLM и upsert в БД (идемпотентно при гонках).
 * Строка записывается ВСЕГДА, даже если LLM недоступна: структурный прогноз (планеты,
 * лепестки, math_level) не зависит от LLM, а тексты в этом случае — детерминированные
 * заглушки, которые самозалечиваются при следующем успешном прогоне.
 */
export async function ensureGlobalDailyContentRow(db: SupabaseClient, forecastDateUtc: string): Promise<void> {
  const forecast = computeGlobalDailyForecast(forecastDateUtc);
  const mathLevel = buildGlobalMathLevel(forecast);
  const texts = await generateGlobalTexts(db, forecast);

  const row = normalizeRecommendationFields({
    forecast_date_utc: forecastDateUtc,
    planet_positions: forecast.planet_positions,
    primary_planet: forecast.primary_planet,
    primary_chakra_number: forecast.primary_chakra_number,
    primary_tone: forecast.primary_tone,
    top_petals: forecast.top_petals,
    slogan: texts.slogan,
    short_text: texts.short_text,
    long_explanation: texts.long_explanation,
    math_level: mathLevel,
    generated_at: new Date().toISOString(),
    llm_tokens_used: null as number | null,
    llm_model: texts.modelUsed,
    expires_at_utc: calcExpiresAt(forecastDateUtc),
  }, "ru");

  const { error } = await db.from("global_daily_content").upsert(row, { onConflict: "forecast_date_utc" });
  if (error) throw error;

  // Переводы заглушек бессмысленны (и снова упрутся в недоступную LLM) — пропускаем.
  if (texts.isFallback) return;

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

/**
 * БЫСТРЫЙ детерминированный путь: считает эфемериды + math_level и сразу upsert строку
 * с fallback-текстами и `llm_model = null` (без LLM-вызова). Возвращает её, чтобы роут
 * мог ответить клиенту за ~1–2s — далеко в пределах `GLOBAL_CONTENT_TIMEOUT_MS = 25s`,
 * даже когда DeepSeek/Gemini холодный или недоступен. Настоящие LLM-тексты догоняет
 * фоновый `ensureGlobalDailyContentRow` (через `globalContentNeedsRefresh` → true,
 * потому что `llm_model = null`). Идемпотентна при гонках.
 */
export async function writeStructuralGlobalRow(
  db: SupabaseClient,
  forecastDateUtc: string,
): Promise<Record<string, unknown>> {
  const forecast = computeGlobalDailyForecast(forecastDateUtc);
  const mathLevel = buildGlobalMathLevel(forecast);
  const row = normalizeRecommendationFields({
    forecast_date_utc: forecastDateUtc,
    planet_positions: forecast.planet_positions,
    primary_planet: forecast.primary_planet,
    primary_chakra_number: forecast.primary_chakra_number,
    primary_tone: forecast.primary_tone,
    top_petals: forecast.top_petals,
    slogan: GLOBAL_FALLBACK_SLOGAN,
    short_text: GLOBAL_FALLBACK_SHORT_TEXT,
    long_explanation: GLOBAL_FALLBACK_LONG_EXPLANATION,
    math_level: mathLevel,
    generated_at: new Date().toISOString(),
    llm_tokens_used: null as number | null,
    llm_model: null,
    expires_at_utc: calcExpiresAt(forecastDateUtc),
  }, "ru");

  const { error } = await db.from("global_daily_content").upsert(row, { onConflict: "forecast_date_utc" });
  if (error) throw error;
  return row;
}
