import type { SupabaseClient } from "@supabase/supabase-js";
import chakraStatesBaseline from "../../../../data/chakra_states_baseline.json";
import { CONTENT_LENGTHS } from "../../../../config/contentLengths";
import {
  buildOutputLanguageBlock,
  buildOutputLanguageRetryBlock,
  isMorningRecommendationCacheValid,
  morningTextsMatchLocale,
  MORNING_CACHE_OUTPUT_LOCALE_KEY,
} from "../../_utils/outputLanguagePrompt";
import { normalizeRecommendationFields } from "../../_utils/recommendationText";
import { resolveContentLocale, type AppContentLocale } from "../../_utils/contentLocales";
import { loadActiveNatalProfile } from "../../_utils/astro-db";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "../../_utils/authorVoice";
import { generateGeminiJson, getModelByHint } from "../../_utils/gemini";
import { buildMathLevel } from "../../_utils/mathLevelBuilder";
import { reportRouteError } from "../../_utils/monitoring";
import {
  inferMorningSourceLocale,
  translateMorningFromCachedSource,
  withMorningSourceMeta,
} from "../../_utils/morningLocaleSwitch";
import { translateMorningTextFields } from "../../_utils/pretranslateGlobalTexts";
import { getActivePrompt, renderPrompt } from "../../_utils/prompts";
import { checkScenarioCache, saveScenarioCache } from "../../_utils/scenarioCache";
import { getScenario } from "../../_utils/scenarios";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { buildTopPetals, describePetalsRelation, type CalibrationLike, type PetalData } from "../../_utils/topPetals";

export const runtime = "nodejs";

type Body = {
  scenario_id?: string;
  variables?: Record<string, unknown>;
  responseLocale?: string;
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

async function buildMorningRecommendationVariables(
  db: SupabaseClient,
  userId: string,
  clientVariables: Record<string, unknown>,
  responseLocale: AppContentLocale,
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

  const language = responseLocale;
  const addressForm = user.address_form === "informal" ? "ty" : "vy";
  const authorVoice = formatAuthorVoiceForPrompt(getAuthorVoice(language), addressForm);
  const [primary, secondary, tertiary] = petals;
  const primaryBaseline = baselineForPlanet(primary.planet);
  const secondaryBaseline = baselineForPlanet(secondary.planet);
  const tertiaryBaseline = baselineForPlanet(tertiary.planet);

  return {
    variables: {
      ...clientVariables,
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
      user_phrases: userPhrasesForPetals(calibration, petals),
    },
    mathLevel: buildMathLevel(forecast, natalResult.profile, calibration, responseLocale),
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
    const user = await loadUser(db, userId);
    const responseLocale = resolveContentLocale(user.locale, body.responseLocale);
    const cacheSuffix = scenario.id === "morning_recommendation" ? responseLocale : undefined;

    endpointStage = "cache_lookup";
    const forceRefresh = body.variables?.forceRefresh === true || body.variables?.force_refresh === true;
    const localeSwitch = body.variables?.localeSwitch === true || body.variables?.locale_switch === true;
    const cached = await checkScenarioCache<Record<string, unknown>>(scenario, userId, db, cacheSuffix);
    if (
      !forceRefresh
      && cached
      && (scenario.id !== "morning_recommendation"
        || isMorningRecommendationCacheValid(cached, expectedModel, responseLocale))
    ) {
      const cachedPayload =
        scenario.id === "morning_recommendation"
          ? normalizeRecommendationFields(cached, responseLocale)
          : cached;
      return json({
        ...cachedPayload,
        cached: true,
        scenario_id: scenario.id,
      });
    }

    // Profile locale switch: translate canonical source texts instead of a full
    // morning regenerate (avoids 60–120s big-prompt path when another locale exists).
    if (scenario.id === "morning_recommendation" && localeSwitch) {
      endpointStage = "locale_switch_translate";
      try {
        const switched = await translateMorningFromCachedSource({
          db,
          userId,
          targetLocale: responseLocale,
        });
        endpointStage = "prepare_morning_recommendation";
        const prepared = await buildMorningRecommendationVariables(
          db,
          userId,
          addScenarioVariables(scenario.id, body.variables ?? {}),
          responseLocale,
        );
        const switchedPayload = withMorningSourceMeta(
          normalizeRecommendationFields(
            {
              slogan: switched.slogan,
              short_text: switched.short_text,
              long_explanation: switched.long_explanation,
              math_level: prepared.mathLevel ?? switched.math_level,
              modelUsed: switched.modelUsed,
            },
            responseLocale,
          ) as Record<string, unknown>,
          {
            outputLocale: responseLocale,
            sourceLocale: switched.sourceLocale,
            sourceTexts: switched.sourceTexts,
            generationMode: "translated",
          },
        );
        endpointStage = "cache_save";
        await saveScenarioCache(scenario, userId, switchedPayload, db, cacheSuffix);
        return json({
          ...switchedPayload,
          cached: false,
          localeSwitch: true,
          scenario_id: scenario.id,
        });
      } catch (switchError) {
        // No source for today → fall through to full generate.
        console.info(
          "[ai/monologue] localeSwitch fell back to generate",
          switchError instanceof Error ? switchError.message : switchError,
        );
      }
    }

    let variables = addScenarioVariables(scenario.id, body.variables ?? {});
    let mathLevel: ReturnType<typeof buildMathLevel> | null = null;
    if (scenario.id === "morning_recommendation") {
      endpointStage = "prepare_morning_recommendation";
      const prepared = await buildMorningRecommendationVariables(db, userId, variables, responseLocale);
      variables = prepared.variables;
      mathLevel = prepared.mathLevel;
    }

    endpointStage = "generate";
    const maxOutputTokens =
      scenario.id === "morning_recommendation"
        ? Math.max(prompt.max_output_tokens ?? 2200, 6144)
        : (prompt.max_output_tokens ?? 1500);
    const rendered = renderPrompt(prompt.template, variables);
    const model = getModelByHint(prompt.model_hint);

    const generateMorningPayload = async (retryLanguage: boolean) => {
      const languagePrefix = retryLanguage
        ? `${buildOutputLanguageRetryBlock(responseLocale)}\n\n${buildOutputLanguageBlock(responseLocale)}`
        : buildOutputLanguageBlock(responseLocale);
      const promptText =
        scenario.id === "morning_recommendation"
          ? `${languagePrefix}\n\n${rendered}`
          : rendered;
      const result = await generateGeminiJson<Record<string, unknown>>({
        prompt: promptText,
        model,
        temperature: prompt.temperature,
        maxOutputTokens,
      });
      const rawPayload = {
        ...result.json,
        ...(mathLevel ? { math_level: mathLevel } : {}),
        modelUsed: result.modelUsed,
        ...(scenario.id === "morning_recommendation"
          ? { [MORNING_CACHE_OUTPUT_LOCALE_KEY]: responseLocale }
          : {}),
      };
      return scenario.id === "morning_recommendation"
        ? normalizeRecommendationFields(rawPayload, responseLocale)
        : rawPayload;
    };

    let payload = await generateMorningPayload(false);
    if (scenario.id === "morning_recommendation") {
      const morning = payload as Record<string, unknown>;
      let slogan = String(morning.slogan ?? "").trim();
      let shortText = String(morning.short_text ?? "").trim();
      let longText = String(morning.long_explanation ?? "").trim();
      let sourceTexts = { slogan, short_text: shortText, long_explanation: longText };
      let sourceLocale = responseLocale;
      // Prompt context is RU-heavy; models often ignore OUTPUT LANGUAGE.
      // One language-retry, then the same translate path as free-tier text_i18n.
      if (!morningTextsMatchLocale(responseLocale, slogan, shortText)) {
        endpointStage = "generate_language_retry";
        payload = await generateMorningPayload(true);
        const retry = payload as Record<string, unknown>;
        slogan = String(retry.slogan ?? "").trim();
        shortText = String(retry.short_text ?? "").trim();
        longText = String(retry.long_explanation ?? "").trim();
        sourceTexts = { slogan, short_text: shortText, long_explanation: longText };
        sourceLocale = responseLocale;
      }
      if (!morningTextsMatchLocale(responseLocale, slogan, shortText)) {
        endpointStage = "generate_language_translate";
        // Keep pre-translate LLM output as the canonical source for future switches.
        sourceTexts = { slogan, short_text: shortText, long_explanation: longText };
        sourceLocale = inferMorningSourceLocale(sourceTexts, "en");
        const translated = await translateMorningTextFields(
          sourceTexts,
          responseLocale,
          sourceLocale,
        );
        slogan = translated.slogan;
        shortText = translated.short_text;
        longText = translated.long_explanation;
        if (!morningTextsMatchLocale(responseLocale, slogan, shortText)) {
          return json(
            { error: "Morning recommendation generated in the wrong language", code: "LOCALE_MISMATCH" },
            { status: 502 },
          );
        }
      } else {
        sourceTexts = { slogan, short_text: shortText, long_explanation: longText };
        sourceLocale = responseLocale;
      }
      const generatedPayload = withMorningSourceMeta(
        normalizeRecommendationFields(
          {
            ...(payload as Record<string, unknown>),
            slogan,
            short_text: shortText,
            long_explanation: longText,
            [MORNING_CACHE_OUTPUT_LOCALE_KEY]: responseLocale,
          },
          responseLocale,
        ) as Record<string, unknown>,
        {
          outputLocale: responseLocale,
          sourceLocale,
          sourceTexts,
          generationMode: "generated",
        },
      );
      payload = generatedPayload as unknown as typeof payload;
    }

    endpointStage = "cache_save";
    await saveScenarioCache(scenario, userId, payload, db, cacheSuffix);

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
