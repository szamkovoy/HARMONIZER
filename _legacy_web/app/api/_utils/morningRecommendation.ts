import type { SupabaseClient } from "@supabase/supabase-js";

import chakraStatesBaseline from "../../../data/chakra_states_baseline.json";
import { CONTENT_LENGTHS } from "../../../config/contentLengths";
import type { NatalProfile } from "../../../modules/astro-core";
import type { DailyForecast } from "../../../modules/daily-engine";
import { buildAddressFormHint } from "./addressForm";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "./authorVoice";
import { generateGeminiJson, getModelByHint } from "./gemini";
import { buildMathLevel } from "./mathLevelBuilder";
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

function isStaleMorningCache(
  cached: Record<string, unknown>,
  expectedModel: string | null,
): boolean {
  if (!cached.math_level) return true;
  if (!expectedModel) return false;
  const used = typeof cached.modelUsed === "string" ? cached.modelUsed.trim() : "";
  return !used || used !== expectedModel;
}

async function loadUser(db: SupabaseClient, userId: string): Promise<UserRecord> {
  const { data, error } = await db.from("users").select("locale,address_form").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as UserRecord | null) ?? {};
}

function baselineForPlanet(planet: PetalData["planet"]): Required<BaselineStates> {
  const baseline = (chakraStatesBaseline as Record<string, BaselineStates>)[planet] ?? {};
  return {
    harmonicStates: baseline.harmonicStates ?? [],
    dissonantStates: baseline.dissonantStates ?? [],
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

function buildVariables(params: {
  forecast: DailyForecast;
  natalProfile: NatalProfile;
  calibration: CalibrationLike | null;
  user: UserRecord;
  clientVariables?: Record<string, unknown>;
}): { variables: Record<string, unknown>; mathLevel: ReturnType<typeof buildMathLevel> } {
  const petals = buildTopPetals(params.forecast, params.natalProfile, params.calibration, 3);
  if (petals.length < 3) {
    throw new Error("Daily forecast does not contain enough ranked planets");
  }

  const language = (params.user.locale ?? "ru").slice(0, 2);
  const addressForm = params.user.address_form === "informal" ? "ty" : "vy";
  const authorVoice = formatAuthorVoiceForPrompt(getAuthorVoice(language), addressForm);
  const addressFormHint = buildAddressFormHint(params.user.address_form, language);
  const [primary, secondary, tertiary] = petals;
  const primaryBaseline = baselineForPlanet(primary.planet);
  const secondaryBaseline = baselineForPlanet(secondary.planet);
  const tertiaryBaseline = baselineForPlanet(tertiary.planet);
  const mathLevel = buildMathLevel(params.forecast, params.natalProfile, params.calibration);

  return {
    variables: {
      ...(params.clientVariables ?? {}),
      author_voice_block: authorVoice,
      short_text_target: CONTENT_LENGTHS.SHORT_TEXT_TARGET_CHARS,
      slogan_target: CONTENT_LENGTHS.SLOGAN_TARGET_CHARS,
      long_explanation_target: CONTENT_LENGTHS.LONG_EXPLANATION_TARGET_CHARS,
      primary_planet: primary.planet,
      primary_chakra_number: primary.chakra_number,
      primary_chakra_label: primary.chakra_label,
      primary_strength: primary.strength,
      primary_harmoniousness: primary.harmoniousness,
      primary_tone: primary.tone,
      primary_transit: primary.main_transit,
      primary_aspect: primary.main_aspect,
      secondary_planet: secondary.planet,
      secondary_chakra_number: secondary.chakra_number,
      secondary_chakra_label: secondary.chakra_label,
      secondary_strength: secondary.strength,
      secondary_harmoniousness: secondary.harmoniousness,
      secondary_tone: secondary.tone,
      tertiary_planet: tertiary.planet,
      tertiary_chakra_number: tertiary.chakra_number,
      tertiary_chakra_label: tertiary.chakra_label,
      tertiary_strength: tertiary.strength,
      tertiary_harmoniousness: tertiary.harmoniousness,
      tertiary_tone: tertiary.tone,
      petals_relation: describePetalsRelation(petals),
      primary_baseline_harmonic: primaryBaseline.harmonicStates,
      primary_baseline_dissonant: primaryBaseline.dissonantStates,
      secondary_baseline_harmonic: secondaryBaseline.harmonicStates,
      secondary_baseline_dissonant: secondaryBaseline.dissonantStates,
      tertiary_baseline_harmonic: tertiaryBaseline.harmonicStates,
      tertiary_baseline_dissonant: tertiaryBaseline.dissonantStates,
      user_phrases_for_active_chakras: userPhrasesForPetals(params.calibration, petals),
      address_form_hint: addressFormHint,
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

  if (!params.forceRefresh) {
    const cached = await checkScenarioCache<Record<string, unknown>>(scenario, params.userId, params.db);
    if (cached && !isStaleMorningCache(cached, expectedModel)) {
      return {
        slogan: String(cached.slogan ?? "").trim(),
        short_text: String(cached.short_text ?? "").trim(),
        long_explanation: String(cached.long_explanation ?? "").trim(),
        math_level: cached.math_level as ReturnType<typeof buildMathLevel>,
        modelUsed: typeof cached.modelUsed === "string" ? cached.modelUsed : null,
      };
    }
  }

  const user = await loadUser(params.db, params.userId);
  const prepared = buildVariables({
    forecast: params.forecast,
    natalProfile: params.natalProfile,
    calibration: params.calibration,
    user,
    clientVariables: params.clientVariables,
  });

  const result = await generateGeminiJson<Record<string, unknown>>({
    prompt: renderPrompt(prompt.template, prepared.variables),
    model: getModelByHint(prompt.model_hint),
    temperature: prompt.temperature,
    maxOutputTokens: Math.max(prompt.max_output_tokens ?? 2200, 6144),
  });

  const payload: MorningRecommendationPayload = {
    slogan: String(result.json.slogan ?? "").trim(),
    short_text: String(result.json.short_text ?? "").trim(),
    long_explanation: String(result.json.long_explanation ?? "").trim(),
    math_level: prepared.mathLevel,
    modelUsed: result.modelUsed,
  };

  await saveScenarioCache(
    scenario,
    params.userId,
    {
      ...payload,
      math_level: payload.math_level,
      modelUsed: payload.modelUsed,
    },
    params.db,
  );

  return payload;
}
