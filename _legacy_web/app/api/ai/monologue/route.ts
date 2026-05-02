import type { SupabaseClient } from "@supabase/supabase-js";
import chakraStatesBaseline from "../../../../data/chakra_states_baseline.json";
import { CONTENT_LENGTHS } from "../../../../config/contentLengths";
import { buildAddressFormHint } from "../../_utils/addressForm";
import { loadActiveNatalProfile } from "../../_utils/astro-db";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "../../_utils/authorVoice";
import { generateGeminiJson, getModelByHint } from "../../_utils/gemini";
import { buildMathLevel } from "../../_utils/mathLevelBuilder";
import { reportRouteError } from "../../_utils/monitoring";
import { getActivePrompt, renderPrompt } from "../../_utils/prompts";
import { checkScenarioCache, saveScenarioCache } from "../../_utils/scenarioCache";
import { getScenario } from "../../_utils/scenarios";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { buildTopPetals, describePetalsRelation, type CalibrationLike, type PetalData } from "../../_utils/topPetals";

export const runtime = "nodejs";

type Body = {
  scenario_id?: string;
  variables?: Record<string, unknown>;
};

type UserRecord = {
  locale?: string | null;
  address_form?: string | null;
  tz?: string | null;
};

type BaselineStates = {
  harmonicStates?: string[];
  dissonantStates?: string[];
};

function isStaleMorningCache(
  scenarioId: string,
  cached: Record<string, unknown>,
  expectedModel: string | null,
): boolean {
  if (scenarioId !== "morning_recommendation") return false;
  if (!cached.math_level) return true;
  if (!expectedModel) return false;
  const used = typeof (cached as { modelUsed?: unknown }).modelUsed === "string" ? (cached as { modelUsed: string }).modelUsed.trim() : "";
  // Старый кэш без modelUsed или с другой моделью (после смены env / tier) — пересчитать.
  if (!used) return true;
  return used !== expectedModel;
}

async function loadActiveCalibration(db: SupabaseClient, userId: string): Promise<CalibrationLike | null> {
  const { data, error } = await db
    .from("user_calibrations")
    .select("version,source,s_calibrated,h_calibrated,delta_from_initial,states_map,user_lexicon")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as CalibrationLike | null) ?? null;
}

async function loadLatestForecast(db: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from("user_daily_forecasts")
    .select("*")
    .eq("user_id", userId)
    .order("forecast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Response(JSON.stringify({ error: "Daily forecast not found" }), { status: 404 });
  return data as Record<string, unknown>;
}

async function loadUser(db: SupabaseClient, userId: string): Promise<UserRecord> {
  const { data, error } = await db.from("users").select("locale,address_form,tz").eq("id", userId).maybeSingle();
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

async function buildMorningRecommendationVariables(
  db: SupabaseClient,
  userId: string,
  clientVariables: Record<string, unknown>,
): Promise<{ variables: Record<string, unknown>; mathLevel: ReturnType<typeof buildMathLevel> }> {
  const [forecast, natalResult, calibration, user] = await Promise.all([
    loadLatestForecast(db, userId),
    loadActiveNatalProfile(db, userId),
    loadActiveCalibration(db, userId),
    loadUser(db, userId),
  ]);

  const petals = buildTopPetals(forecast, natalResult.profile, calibration, 3);
  if (petals.length < 3) {
    throw new Response(JSON.stringify({ error: "Daily forecast does not contain enough ranked planets" }), { status: 500 });
  }

  const language = (user.locale ?? "ru").slice(0, 2);
  const addressForm = user.address_form === "informal" ? "ty" : "vy";
  const authorVoice = formatAuthorVoiceForPrompt(getAuthorVoice(language), addressForm);
  const addressFormHint = buildAddressFormHint(user.address_form, language);
  const [primary, secondary, tertiary] = petals;
  const primaryBaseline = baselineForPlanet(primary.planet);
  const secondaryBaseline = baselineForPlanet(secondary.planet);
  const tertiaryBaseline = baselineForPlanet(tertiary.planet);

  return {
    variables: {
      ...clientVariables,
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
      user_phrases_for_active_chakras: userPhrasesForPetals(calibration, petals),
      address_form_hint: addressFormHint,
    },
    mathLevel: buildMathLevel(forecast, natalResult.profile, calibration),
  };
}

function addScenarioVariables(scenarioId: string, variables: Record<string, unknown>): Record<string, unknown> {
  if (scenarioId === "psychological_portrait") {
    return {
      ...variables,
      portrait_target_chars: CONTENT_LENGTHS.PORTRAIT_TARGET_CHARS,
    };
  }
  return variables;
}

export async function POST(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  let endpointStage = "request";
  try {
    userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const scenarioId = body.scenario_id?.trim();
    if (!scenarioId) return json({ error: "scenario_id is required" }, { status: 400 });

    db = createServiceSupabase();
    endpointStage = "load_scenario";
    const scenario = await getScenario(scenarioId, db);
    if (!scenario) return json({ error: "Scenario not found" }, { status: 404 });
    if (scenario.scenario_type !== "monologue") {
      return json({ error: "This endpoint is for monologue scenarios. Use /api/ai/dialog for dialogues." }, { status: 400 });
    }
    if (!scenario.monologue_prompt_key) {
      return json({ error: "Scenario has no monologue prompt configured" }, { status: 500 });
    }

    endpointStage = "load_prompt";
    const prompt = await getActivePrompt(db, scenario.monologue_prompt_key);
    const expectedModel = scenario.id === "morning_recommendation" ? getModelByHint(prompt.model_hint) : null;

    endpointStage = "cache_lookup";
    const forceRefresh = body.variables?.forceRefresh === true || body.variables?.force_refresh === true;
    const cached = await checkScenarioCache<Record<string, unknown>>(scenario, userId, db);
    if (!forceRefresh && cached && !isStaleMorningCache(scenario.id, cached, expectedModel)) {
      return json({
        ...cached,
        cached: true,
        scenario_id: scenario.id,
      });
    }
    let variables = addScenarioVariables(scenario.id, body.variables ?? {});
    let mathLevel: ReturnType<typeof buildMathLevel> | null = null;
    if (scenario.id === "morning_recommendation") {
      endpointStage = "prepare_morning_recommendation";
      const prepared = await buildMorningRecommendationVariables(db, userId, variables);
      variables = prepared.variables;
      mathLevel = prepared.mathLevel;
    }

    endpointStage = "generate";
    const maxOutputTokens =
      scenario.id === "morning_recommendation"
        ? Math.max(prompt.max_output_tokens ?? 2200, 6144)
        : (prompt.max_output_tokens ?? 1500);
    const result = await generateGeminiJson<Record<string, unknown>>({
      prompt: renderPrompt(prompt.template, variables),
      model: getModelByHint(prompt.model_hint),
      temperature: prompt.temperature,
      maxOutputTokens,
    });
    const payload = {
      ...result.json,
      ...(mathLevel ? { math_level: mathLevel } : {}),
      modelUsed: result.modelUsed,
    };

    endpointStage = "cache_save";
    await saveScenarioCache(scenario, userId, payload, db);

    return json({
      ...payload,
      cached: false,
      scenario_id: scenario.id,
    });
  } catch (error) {
    await reportRouteError(error, {
      db,
      userId,
      endpoint: "ai/monologue",
      stage: endpointStage,
    });
    return errorResponse(error);
  }
}
