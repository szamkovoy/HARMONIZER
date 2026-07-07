import type { SupabaseClient } from "@supabase/supabase-js";

import chakraStatesBaseline from "../../../data/chakra_states_baseline.json";
import { CONTENT_LENGTHS } from "../../../config/contentLengths";
import type { NatalProfile } from "../../../modules/astro-core";
import type { DailyForecast } from "../../../modules/daily-engine";
import { resolveContentLocale, type AppContentLocale } from "./contentLocales";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "./authorVoice";
import { generateGeminiJson, getModelByHint } from "./gemini";
import { buildMathLevel } from "./mathLevelBuilder";
import { normalizeRecommendationFields } from "./recommendationText";
import {
  buildOutputLanguageBlock,
  isMorningRecommendationCacheValid,
  MORNING_CACHE_OUTPUT_LOCALE_KEY,
} from "./outputLanguagePrompt";
import { getActivePrompt, renderPrompt } from "./prompts";
import { checkScenarioCache, saveScenarioCache } from "./scenarioCache";
import { getScenario } from "./scenarios";
import { buildTopPetals, describePetalsRelation, type CalibrationLike, type PetalData } from "./topPetals";

type UserRecord = {
  locale?: string | null;
  address_form?: string | null;
};

type BaselineStates = {
  harmonicStates?: string[];
  dissonantStates?: string[];
};

export type MorningRecommendationPayload = {
  slogan: string;
  short_text: string;
  long_explanation: string;
  math_level: ReturnType<typeof buildMathLevel>;
  modelUsed: string | null;
};

function payloadFromCachedMorning(
  cached: Record<string, unknown>,
  responseLocale: AppContentLocale,
): MorningRecommendationPayload {
  const normalized = normalizeRecommendationFields(cached, responseLocale);
  return {
    slogan: String(normalized.slogan ?? "").trim(),
    short_text: String(normalized.short_text ?? "").trim(),
    long_explanation: String(normalized.long_explanation ?? "").trim(),
    math_level: normalized.math_level as ReturnType<typeof buildMathLevel>,
    modelUsed: typeof normalized.modelUsed === "string" ? normalized.modelUsed : null,
  };
}

/** Read cron / monologue cache only — no LLM generation. */
export async function loadCachedMorningRecommendation(params: {
  db: SupabaseClient;
  userId: string;
  responseLocale?: AppContentLocale;
  requestedLocale?: string | null;
}): Promise<MorningRecommendationPayload | null> {
  const scenario = await getScenario("morning_recommendation", params.db);
  if (!scenario?.monologue_prompt_key) return null;
  const prompt = await getActivePrompt(params.db, scenario.monologue_prompt_key);
  const expectedModel = getModelByHint(prompt.model_hint);
  const user = await loadUser(params.db, params.userId);
  const responseLocale = resolveContentLocale(user.locale, params.responseLocale ?? params.requestedLocale);
  const cached = await checkScenarioCache<Record<string, unknown>>(scenario, params.userId, params.db, responseLocale);
  if (!cached || !isMorningRecommendationCacheValid(cached, expectedModel, responseLocale)) {
    return null;
  }
  return payloadFromCachedMorning(cached, responseLocale);
}

async function loadUser(db: SupabaseClient, userId: string): Promise<UserRecord> {
  const { data, error } = await db.from("users").select("locale,address_form").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as UserRecord | null) ?? {};
}

function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function baselineForPlanet(planet: PetalData["planet"]): Required<BaselineStates> {
  const baseline = (chakraStatesBaseline as Record<string, BaselineStates>)[planet] ?? {};
  // Shuffle to break LLM primacy bias (anchoring on the first words of the list),
  // so each generation emphasises a different cluster of states for the same planet.
  return {
    harmonicStates: shuffle(baseline.harmonicStates ?? []),
    dissonantStates: shuffle(baseline.dissonantStates ?? []),
  };
}

function userPhrasesForPetals(calibration: CalibrationLike | null, petals: PetalData[]): string[] {
  const activePlanets = new Set(petals.map((petal) => petal.planet));
  return [...(calibration?.user_lexicon?.phrases ?? [])]
    .filter((phrase) => {
      const planet = phrase.associated_planet ?? phrase.planet;
      return planet ? activePlanets.has(planet as PetalData["planet"]) : false;
    })
    .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))
    .slice(0, 5)
    .map((phrase) => phrase.text)
    .filter((text): text is string => Boolean(text));
}

function buildPersonalizationModePaid(addressForm: "ty" | "vy"): string {
  const form = addressForm === "ty" ? "«ты»" : "«вы»";
  return [
    "РЕЖИМ ПЕРСОНАЛИЗАЦИИ: персональный прогноз.",
    "Это прогноз на основе натальной карты пользователя и его калибровки.",
    `Обращайся к пользователю лично, форма обращения — ${form} (задана в блоке авторского голоса выше).`,
    "Можно вплетать личные формулировки пользователя, если они уместны и попадают в тон.",
    "Учитывай активирующий транзит транзитной планеты к натальной планете — он уточняет тему дня.",
  ].join("\n");
}

function buildVariables(params: {
  forecast: DailyForecast;
  natalProfile: NatalProfile;
  calibration: CalibrationLike | null;
  user: UserRecord;
  clientVariables?: Record<string, unknown>;
  responseLocale?: AppContentLocale;
}): { variables: Record<string, unknown>; mathLevel: ReturnType<typeof buildMathLevel> } {
  const petals = buildTopPetals(params.forecast, params.natalProfile, params.calibration, 3);
  if (petals.length < 3) {
    throw new Error("Daily forecast does not contain enough ranked planets");
  }

  const language = resolveContentLocale(params.user.locale, params.responseLocale ?? (params.clientVariables?.responseLocale as string | undefined));
  const addressForm = params.user.address_form === "informal" ? "ty" : "vy";
  const authorVoice = formatAuthorVoiceForPrompt(getAuthorVoice(language), addressForm);
  const [primary, secondary, tertiary] = petals;
  const primaryBaseline = baselineForPlanet(primary.planet);
  const secondaryBaseline = baselineForPlanet(secondary.planet);
  const tertiaryBaseline = baselineForPlanet(tertiary.planet);
  const mathLevel = buildMathLevel(params.forecast, params.natalProfile, params.calibration, language);

  return {
    variables: {
      ...(params.clientVariables ?? {}),
      author_voice_block: authorVoice,
      personalization_mode: buildPersonalizationModePaid(addressForm),
      short_text_target: CONTENT_LENGTHS.SHORT_TEXT_TARGET_CHARS,
      slogan_target: CONTENT_LENGTHS.SLOGAN_TARGET_CHARS,
      long_explanation_target: CONTENT_LENGTHS.LONG_EXPLANATION_TARGET_CHARS,
      primary_planet: primary.planet,
      primary_chakra: primary.chakra_label,
      primary_harmoniousness: primary.harmoniousness,
      primary_main_transit: primary.main_transit ?? "",
      primary_main_aspect: primary.main_aspect ?? "",
      secondary_planet: secondary.planet,
      secondary_chakra: secondary.chakra_label,
      secondary_harmoniousness: secondary.harmoniousness,
      tertiary_planet: tertiary.planet,
      tertiary_chakra: tertiary.chakra_label,
      tertiary_harmoniousness: tertiary.harmoniousness,
      petals_relation: describePetalsRelation(petals),
      primary_harmonic_states: primaryBaseline.harmonicStates.join(", "),
      primary_dissonant_states: primaryBaseline.dissonantStates.join(", "),
      secondary_harmonic_states: secondaryBaseline.harmonicStates.join(", "),
      secondary_dissonant_states: secondaryBaseline.dissonantStates.join(", "),
      tertiary_harmonic_states: tertiaryBaseline.harmonicStates.join(", "),
      tertiary_dissonant_states: tertiaryBaseline.dissonantStates.join(", "),
      user_phrases: userPhrasesForPetals(params.calibration, petals),
    },
    mathLevel,
  };
}

export async function ensureMorningRecommendation(params: {
  db: SupabaseClient;
  userId: string;
  forecast: DailyForecast;
  natalProfile: NatalProfile;
  calibration: CalibrationLike | null;
  forceRefresh?: boolean;
  clientVariables?: Record<string, unknown>;
  responseLocale?: AppContentLocale;
}): Promise<MorningRecommendationPayload> {
  const scenario = await getScenario("morning_recommendation", params.db);
  if (!scenario) {
    throw new Error("Scenario morning_recommendation not found");
  }
  const promptKey = scenario.monologue_prompt_key?.trim();
  if (!promptKey) {
    throw new Error("Scenario morning_recommendation has no monologue_prompt_key");
  }
  const prompt = await getActivePrompt(params.db, promptKey);
  const expectedModel = getModelByHint(prompt.model_hint);
  const user = await loadUser(params.db, params.userId);
  const responseLocale = resolveContentLocale(
    user.locale,
    params.responseLocale ?? (params.clientVariables?.responseLocale as string | undefined),
  );
  const cacheSuffix = responseLocale;

  if (!params.forceRefresh) {
    const cached = await checkScenarioCache<Record<string, unknown>>(scenario, params.userId, params.db, cacheSuffix);
    if (cached && isMorningRecommendationCacheValid(cached, expectedModel, responseLocale)) {
      return payloadFromCachedMorning(cached, responseLocale);
    }
  }

  const prepared = buildVariables({
    forecast: params.forecast,
    natalProfile: params.natalProfile,
    calibration: params.calibration,
    user,
    clientVariables: params.clientVariables,
    responseLocale,
  });

  const result = await generateGeminiJson<Record<string, unknown>>({
    prompt: `${buildOutputLanguageBlock(responseLocale)}\n\n${renderPrompt(prompt.template, prepared.variables)}`,
    model: getModelByHint(prompt.model_hint),
    temperature: prompt.temperature,
    maxOutputTokens: Math.max(prompt.max_output_tokens ?? 2200, 6144),
  });

  const payloadRecord = normalizeRecommendationFields(
    {
      slogan: String(result.json.slogan ?? "").trim(),
      short_text: String(result.json.short_text ?? "").trim(),
      long_explanation: String(result.json.long_explanation ?? "").trim(),
      math_level: prepared.mathLevel,
      modelUsed: result.modelUsed,
    },
    responseLocale,
  );
  const payload: MorningRecommendationPayload = {
    slogan: String(payloadRecord.slogan ?? "").trim(),
    short_text: String(payloadRecord.short_text ?? "").trim(),
    long_explanation: String(payloadRecord.long_explanation ?? "").trim(),
    math_level: payloadRecord.math_level as ReturnType<typeof buildMathLevel>,
    modelUsed: typeof payloadRecord.modelUsed === "string" ? payloadRecord.modelUsed : result.modelUsed,
  };

  await saveScenarioCache(
    scenario,
    params.userId,
    {
      ...payload,
      math_level: payload.math_level,
      modelUsed: payload.modelUsed,
      [MORNING_CACHE_OUTPUT_LOCALE_KEY]: responseLocale,
    },
    params.db,
    cacheSuffix,
  );

  return payload;
}
