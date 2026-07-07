import type { SupabaseClient } from "@supabase/supabase-js";

import chakraStatesBaseline from "../../../data/chakra_states_baseline.json";
import { CONTENT_LENGTHS } from "../../../config/contentLengths";
import { buildGlobalMathLevel, computeGlobalDailyForecast, isGlobalMathLevelCurrent } from "./globalTransitMath";
import { isCurrentGlobalLongExplanation, normalizeRecommendationFields } from "./recommendationText";
import { ensureGlobalTextI18nPrecomputed } from "./globalContentLocale";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "./authorVoice";
import { generateGeminiJson, getModelByHint } from "./gemini";
import { getActivePrompt, renderPrompt } from "./prompts";
import { describePetalsRelation, PLANET_TO_CHAKRA, type PetalData } from "./topPetals";

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

type BaselineStates = {
  harmonicStates?: string[];
  dissonantStates?: string[];
};

const ASPECT_COEF: Record<string, number> = {
  conjunction: 1,
  opposition: 0.9,
  square: 0.8,
  trine: 0.7,
  sextile: 0.5,
};

function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function baselineForPlanet(planet: string): Required<BaselineStates> {
  const baseline = (chakraStatesBaseline as Record<string, BaselineStates>)[planet] ?? {};
  // Shuffle to break LLM primacy bias (anchoring on the first words of the list),
  // so each generation emphasises a different cluster of states for the same planet.
  return {
    harmonicStates: shuffle(baseline.harmonicStates ?? []),
    dissonantStates: shuffle(baseline.dissonantStates ?? []),
  };
}

/** Гармоничность планеты в шкале [-1; +1] по балансу её транзит-транзитных аспектов. */
function globalHarmoniousnessFor(
  planet: string,
  aspects: Array<{ from: string; to: string; type: string }>,
): number {
  let harmonic = 0;
  let dissonant = 0;
  for (const aspect of aspects) {
    if (aspect.from !== planet && aspect.to !== planet) continue;
    const coef = ASPECT_COEF[aspect.type] ?? 0.5;
    if (aspect.type === "trine" || aspect.type === "sextile") harmonic += coef;
    else if (aspect.type === "square" || aspect.type === "opposition") dissonant += coef;
    else harmonic += coef * 0.5; // соединение — нейтрально-положительное
  }
  if (harmonic + dissonant === 0) return 0;
  const ratio = harmonic / (harmonic + dissonant);
  return Math.max(-1, Math.min(1, (ratio - 0.5) * 2));
}

const FREE_PERSONALIZATION_MODE = [
  "РЕЖИМ ПЕРСОНАЛИЗАЦИИ: общий прогноз без натальной карты.",
  "Этот прогноз показывается всем пользователям бесплатного тарифа и строится ТОЛЬКО по транзитной картине дня.",
  "Никакой персонализации, никакого «у вас сегодня», никакого обращения на «ты».",
  "Только уважительное «вы» или безличная форма.",
  "Не упоминай натальную карту пользователя и не выдумывай его биографию, прошлое или обстоятельства.",
  "Активирующий транзит к натальной планете отсутствует — не упоминай его.",
].join("\n");

function buildGlobalVariables(
  forecast: ReturnType<typeof computeGlobalDailyForecast>,
): Record<string, unknown> {
  const [primary, secondary, tertiary] = forecast.top_petals;
  const authorVoice = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "vy");
  const petalsForRelation = forecast.top_petals.map((petal) => ({
    planet: petal.planet,
    tone: petal.tone,
  })) as PetalData[];

  return {
    author_voice_block: authorVoice,
    personalization_mode: FREE_PERSONALIZATION_MODE,
    short_text_target: CONTENT_LENGTHS.SHORT_TEXT_TARGET_CHARS,
    slogan_target: CONTENT_LENGTHS.SLOGAN_TARGET_CHARS,
    long_explanation_target: CONTENT_LENGTHS.LONG_EXPLANATION_TARGET_CHARS,
    primary_planet: primary.planet,
    primary_chakra: PLANET_TO_CHAKRA[primary.planet as keyof typeof PLANET_TO_CHAKRA]?.label ?? primary.chakra_label,
    primary_harmoniousness: globalHarmoniousnessFor(primary.planet, forecast.aspects),
    primary_main_transit: "",
    primary_main_aspect: "",
    secondary_planet: secondary.planet,
    secondary_chakra: PLANET_TO_CHAKRA[secondary.planet as keyof typeof PLANET_TO_CHAKRA]?.label ?? secondary.chakra_label,
    secondary_harmoniousness: globalHarmoniousnessFor(secondary.planet, forecast.aspects),
    tertiary_planet: tertiary.planet,
    tertiary_chakra: PLANET_TO_CHAKRA[tertiary.planet as keyof typeof PLANET_TO_CHAKRA]?.label ?? tertiary.chakra_label,
    tertiary_harmoniousness: globalHarmoniousnessFor(tertiary.planet, forecast.aspects),
    petals_relation: describePetalsRelation(petalsForRelation),
    primary_harmonic_states: baselineForPlanet(primary.planet).harmonicStates.join(", "),
    primary_dissonant_states: baselineForPlanet(primary.planet).dissonantStates.join(", "),
    secondary_harmonic_states: baselineForPlanet(secondary.planet).harmonicStates.join(", "),
    secondary_dissonant_states: baselineForPlanet(secondary.planet).dissonantStates.join(", "),
    tertiary_harmonic_states: baselineForPlanet(tertiary.planet).harmonicStates.join(", "),
    tertiary_dissonant_states: baselineForPlanet(tertiary.planet).dissonantStates.join(", "),
    user_phrases: [],
  };
}

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
      prompt: renderPrompt(prompt.template, buildGlobalVariables(forecast)),
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
