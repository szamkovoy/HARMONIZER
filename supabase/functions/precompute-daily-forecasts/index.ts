// @ts-nocheck
import { DateTime } from "https://esm.sh/luxon@3.7.2";
import { assertCronSecret, createServiceClient, daysAgo, isOptions, json } from "../_shared/supabase.ts";
import { resolveGeminiModelIdFromTierEnv } from "../_shared/geminiModelIds.ts";
import { generateGeminiJson } from "../_shared/llm.ts";
import {
  ASPECT_COEF,
  TRANSIT_WEIGHT,
  computeActivation,
  computeDailyForecast,
  dailyForecastToInsert,
} from "../_shared/dailyForecast.ts";
import { getMathLevelStrings } from "../_shared/mathLevelI18n.ts";
import { CONTENT_LENGTHS } from "../_shared/contentLengths.ts";
import chakraStatesBaseline from "../_shared/data/chakra_states_baseline.json" with { type: "json" };

const BATCH_SIZE = 100;
const ACTIVE_PRECOMPUTE_DAYS = 3;
const MORNING_SCENARIO_ID = "morning_recommendation";
const SUPPORTED_LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;
const MORNING_CACHE_OUTPUT_LOCALE_KEY = "outputLocale";
const PLANETS_7 = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;
const PLANET_TO_CHAKRA = {
  Moon: { number: 1, label: "первая чакра" },
  Venus: { number: 2, label: "вторая чакра" },
  Mars: { number: 3, label: "третья чакра" },
  Jupiter: { number: 4, label: "четвёртая чакра" },
  Saturn: { number: 5, label: "пятая чакра" },
  Mercury: { number: 6, label: "шестая чакра" },
  Sun: { number: 7, label: "седьмая чакра" },
} as const;

type AppContentLocale = (typeof SUPPORTED_LOCALES)[number];

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function natalProfileFromRow(row: any) {
  return {
    precisionMode: row.precision_mode,
    isDayChart: row.is_day_chart,
    ascendant:
      row.ascendant_longitude == null
        ? undefined
        : {
            longitude: row.ascendant_longitude,
            sign: Math.floor(row.ascendant_longitude / 30),
          },
    houseSystem: row.house_system,
    planets: row.planets,
    computedAt: row.computed_at,
    ephemerisLibVersion: row.ephemeris_lib_version ?? "unknown",
  };
}

async function hasRecentActivity(db: any, userId: string): Promise<boolean> {
  const cutoff = daysAgo(ACTIVE_PRECOMPUTE_DAYS);
  const checks = await Promise.all([
    db.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("started_at", cutoff),
    db.from("practice_sessions").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("started_at", cutoff),
    db.from("user_event_log").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("occurred_at", cutoff),
  ]);

  for (const result of checks) {
    if (result.error) throw result.error;
    if ((result.count ?? 0) > 0) return true;
  }
  return false;
}

function normalizeLocale(value: unknown): AppContentLocale {
  const candidate = typeof value === "string" ? value.trim().slice(0, 2).toLowerCase() : "";
  return (SUPPORTED_LOCALES as readonly string[]).includes(candidate) ? (candidate as AppContentLocale) : "ru";
}

function languageNameFor(locale: AppContentLocale): string {
  switch (locale) {
    case "ru":
      return "Russian";
    case "de":
      return "German";
    case "fr":
      return "French";
    case "it":
      return "Italian";
    case "es":
      return "Spanish";
    case "pt":
      return "Portuguese";
    case "nl":
      return "Dutch";
    default:
      return "English";
  }
}

function buildOutputLanguageBlock(locale: AppContentLocale): string {
  if (locale === "ru") {
    return [
      "═══════════════════════════════════════════════════════════════════",
      "ЯЗЫК ОТВЕТА: русский.",
      "Все пользовательские поля JSON (slogan, short_text, long_explanation) — только на русском.",
      "═══════════════════════════════════════════════════════════════════",
    ].join("\n");
  }
  const languageName = languageNameFor(locale);
  return [
    "═══════════════════════════════════════════════════════════════════",
    `OUTPUT LANGUAGE: ${languageName}.`,
    "The instructions below may be in Russian (source data). That is context only.",
    `You MUST write ALL JSON output fields (slogan, short_text, long_explanation) entirely in ${languageName}.`,
    "Do not output Russian (unless quoting a proper noun). Match the empathetic mentor tone.",
    "═══════════════════════════════════════════════════════════════════",
  ].join("\n");
}

function hasPersonalForecastAccess(user: {
  membership_tier?: string | null;
  trial_expires_at?: string | null;
}): boolean {
  const tier = typeof user.membership_tier === "string" ? user.membership_tier.trim().toLowerCase() : "";
  if (tier === "premium" || tier === "oracle" || tier === "practitioner" || tier === "master") return true;
  if (tier === "free" && user.trial_expires_at) {
    return new Date(user.trial_expires_at).getTime() > Date.now();
  }
  return false;
}

async function loadRecentPlanets(db: any, userId: string): Promise<string[]> {
  const { data, error } = await db.from("user_settings").select("preferences").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const recent = data?.preferences?.recentPlanetsOfDay;
  return Array.isArray(recent) ? recent.slice(0, 2) : [];
}

async function loadActiveCalibration(db: any, userId: string) {
  const { data, error } = await db
    .from("user_calibrations")
    .select("s_calibrated,h_calibrated")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function loadFreshForecastCache(db: any, userId: string, forecastDate: string): Promise<any | null> {
  const { data, error } = await db
    .from("user_daily_forecasts")
    .select("*")
    .eq("user_id", userId)
    .eq("forecast_date", forecastDate)
    .gt("cache_valid_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    if (value == null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  });
}

function getTone(harmoniousness: number): "harmonic" | "dissonant" | "ambivalent_strong" {
  if (Math.abs(harmoniousness) < 0.2) return "ambivalent_strong";
  return harmoniousness > 0 ? "harmonic" : "dissonant";
}

function buildTopPetals(
  forecast: any,
  natalProfile: any,
  calibration: any | null,
  topN = 3,
) {
  const ranked = Array.isArray(forecast.rankedPlanets) ? forecast.rankedPlanets : [...PLANETS_7];
  const { contributions } = computeActivation(natalProfile, forecast.transitChart);
  return ranked.slice(0, topN).map((planet) => {
    const natalPlanet = natalProfile.planets[planet];
    const sCal = calibration?.s_calibrated?.[planet] ?? natalPlanet.S_initial;
    const hCal = calibration?.h_calibrated?.[planet] ?? natalPlanet.H_initial;
    const mainContribution = contributions
      .filter((contribution) => contribution.natalPlanet === planet)
      .sort((a, b) => b.value - a.value)[0] ?? null;
    return {
      planet,
      chakra_number: PLANET_TO_CHAKRA[planet].number,
      chakra_label: PLANET_TO_CHAKRA[planet].label,
      importance: Math.round((forecast.importance?.[planet] ?? 0) * 1000) / 1000,
      strength: Math.round(sCal * 100) / 100,
      harmoniousness: Math.round(hCal * 100) / 100,
      tone: getTone(hCal),
      main_transit: mainContribution?.transitPlanet ?? null,
      main_aspect: mainContribution?.aspect.type ?? null,
    };
  });
}

function describePetalsRelation(petals: Array<{ tone: "harmonic" | "dissonant" | "ambivalent_strong" }>): string {
  const harmonicCount = petals.filter((petal) => petal.tone === "harmonic").length;
  const dissonantCount = petals.filter((petal) => petal.tone === "dissonant").length;
  if (harmonicCount === 3) return "чистая волна — все три темы поддерживают друг друга";
  if (dissonantCount === 3) return "тройной вызов — много энергии для глубокой работы, но требует осознанности";
  if (petals[0]?.tone === "harmonic" && dissonantCount > 0) {
    return "поток как основа, но один из обертонов проверяет на устойчивость";
  }
  if (petals[0]?.tone === "dissonant" && harmonicCount > 0) {
    return "главный вызов поддержан более лёгкими резонансами — есть на что опереться";
  }
  return "смешанная картина — несколько разнородных сигналов одновременно";
}

type BaselineStates = {
  harmonicStates?: string[];
  dissonantStates?: string[];
};

function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function baselineForPlanet(planet: string): { harmonicStates: string[]; dissonantStates: string[] } {
  const baseline = (chakraStatesBaseline as Record<string, BaselineStates>)[planet] ?? {};
  // Shuffle to break LLM primacy bias (anchoring on the first words of the list),
  // so each generation emphasises a different cluster of states for the same planet.
  return {
    harmonicStates: shuffle(baseline.harmonicStates ?? []),
    dissonantStates: shuffle(baseline.dissonantStates ?? []),
  };
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

function buildMathLevelForCron(
  forecast: any,
  natalProfile: any,
  calibration: any | null,
  locale: AppContentLocale,
) {
  const t = getMathLevelStrings(locale);
  const md: string[] = [];
  const structured: any = {
    natal_strengths: [],
    main_aspects: [],
    importance_breakdown: [],
  };
  md.push(t.title);
  md.push(t.intro);
  md.push(t.section1Title);
  md.push(t.formulaS);
  md.push(t.formulaH);
  for (const planet of PLANETS_7) {
    const natalPlanet = natalProfile.planets[planet];
    const sCal = calibration?.s_calibrated?.[planet];
    const hCal = calibration?.h_calibrated?.[planet];
    md.push(`\n**${planet}** ${t.chakraLabel(PLANET_TO_CHAKRA[planet].number)}:`);
    md.push(`- ${t.natalS}: ${natalPlanet.S_initial.toFixed(2)}`);
    md.push(`- ${t.natalH}: ${natalPlanet.H_initial.toFixed(2)}`);
    if (sCal !== undefined && Math.abs(sCal - natalPlanet.S_initial) > 0.01) {
      const dS = sCal - natalPlanet.S_initial;
      md.push(`- ${t.calibratedS(sCal.toFixed(2), `${dS >= 0 ? "+" : ""}${dS.toFixed(2)}`)}`);
    }
    if (hCal !== undefined && Math.abs(hCal - natalPlanet.H_initial) > 0.01) {
      const dH = hCal - natalPlanet.H_initial;
      md.push(`- ${t.calibratedH(hCal.toFixed(2), `${dH >= 0 ? "+" : ""}${dH.toFixed(2)}`)}`);
    }
    structured.natal_strengths.push({
      planet,
      chakra: PLANET_TO_CHAKRA[planet].number,
      S: Math.round((sCal ?? natalPlanet.S_initial) * 100) / 100,
      H: Math.round((hCal ?? natalPlanet.H_initial) * 100) / 100,
      formula_summary: `S=${natalPlanet.S_initial.toFixed(2)}`,
    });
  }
  md.push(t.section2Title);
  md.push(t.section2Intro);
  const { contributions } = computeActivation(natalProfile, forecast.transitChart);
  const topContributions = contributions.sort((a, b) => b.value - a.value).slice(0, 12);
  if (!topContributions.length) {
    md.push(t.noTransitChart);
  } else {
    for (const contribution of topContributions) {
      const aspectCoef = ASPECT_COEF[contribution.aspect.type] ?? 0.5;
      const transitWeight = TRANSIT_WEIGHT[contribution.transitPlanet] ?? 0.5;
      const activation = Math.round(contribution.value * 1000) / 1000;
      md.push(t.transitLine(contribution.transitPlanet, contribution.aspect.type, contribution.natalPlanet));
      md.push(t.orbLine(contribution.aspect.orb.toFixed(2), String(aspectCoef), String(transitWeight)));
      md.push(t.activationLine(activation.toFixed(3)));
      structured.main_aspects.push({
        from: contribution.transitPlanet,
        to: contribution.natalPlanet,
        type: contribution.aspect.type,
        orb: Math.round(contribution.aspect.orb * 100) / 100,
        coef: Math.round(aspectCoef * transitWeight * 1000) / 1000,
        activation,
      });
    }
  }
  md.push(t.section3Title);
  md.push(t.section3Formula);
  md.push(t.section3Intro);
  for (const planet of forecast.rankedPlanets ?? PLANETS_7) {
    const sEff = calibration?.s_calibrated?.[planet] ?? natalProfile.planets[planet].S_initial;
    const activation = forecast.activation?.[planet] ?? 0;
    const importance = forecast.importance?.[planet] ?? 0;
    md.push(t.importanceLine(planet, activation.toFixed(3), sEff.toFixed(2), importance.toFixed(3)));
    structured.importance_breakdown.push({
      planet,
      activation: Math.round(activation * 1000) / 1000,
      S_eff: Math.round(sEff * 100) / 100,
      importance: Math.round(importance * 1000) / 1000,
    });
  }
  const planetOfTheDay = forecast.planetOfTheDay ?? (forecast.rankedPlanets?.[0] ?? PLANETS_7[0]);
  md.push(`\n${t.section4Title}`);
  md.push(t.winnerLine(planetOfTheDay, (forecast.importance?.[planetOfTheDay] ?? 0).toFixed(3)));
  if (forecast.isAlternativeChoice) {
    md.push(t.alternativeLine(forecast.alternativeReasonText ?? "сработало правило разнообразия тем"));
  }
  if (calibration) {
    md.push(t.section5Title);
    md.push(
      t.calibrationIntro(
        String(calibration.version ?? "?"),
        String(calibration.source ?? "unknown"),
        calibration.source === "auto_aggregated"
          ? locale === "en"
            ? "50/50 (natal / voice feedback)"
            : "50/50 (натальное / голосовая обратная связь)"
          : locale === "en"
            ? "60/40 (natal / feedback)"
            : "60/40 (натальное / обратная связь)",
      ),
    );
  }
  return { markdown: md.join("\n"), structured };
}

async function loadMorningPromptConfig(db: any) {
  const { data: scenario, error: scenarioError } = await db
    .from("scenarios")
    .select("id,monologue_prompt_key")
    .eq("id", MORNING_SCENARIO_ID)
    .eq("is_active", true)
    .maybeSingle();
  if (scenarioError) throw scenarioError;
  if (!scenario?.monologue_prompt_key) throw new Error("Morning scenario is not configured");

  let promptQuery = db
    .from("prompts")
    .select("template,model_hint,temperature,max_output_tokens")
    .eq("prompt_key", scenario.monologue_prompt_key)
    .eq("is_active", true)
    .limit(1);
  const { data: promptRows, error: promptError } = await promptQuery;
  if (promptError) throw promptError;
  const prompt = promptRows?.[0];
  if (!prompt) throw new Error("Morning prompt is not configured");
  return {
    scenarioId: scenario.id,
    promptKey: scenario.monologue_prompt_key,
    prompt,
    expectedModel: resolveGeminiModelIdFromTierEnv(prompt.model_hint),
  };
}

function morningCacheKey(userId: string, forecastDate: string, locale: AppContentLocale): string {
  return `${MORNING_SCENARIO_ID}:${userId}:${forecastDate}:${locale}`;
}

async function loadFreshMorningCache(
  db: any,
  userId: string,
  forecastDate: string,
  locale: AppContentLocale,
  expectedModel: string,
) {
  const { data, error } = await db
    .from("scenario_cache")
    .select("data")
    .eq("cache_key", morningCacheKey(userId, forecastDate, locale))
    .maybeSingle();
  if (error) throw error;
  const cached = data?.data;
  if (!cached?.math_level) return null;
  if (cached?.[MORNING_CACHE_OUTPUT_LOCALE_KEY] !== locale) return null;
  if (typeof cached?.modelUsed !== "string" || cached.modelUsed.trim() !== expectedModel) return null;
  return cached;
}

async function precomputeMorningRecommendation(params: {
  db: any;
  userId: string;
  forecastDate: string;
  locale: AppContentLocale;
  promptConfig: Awaited<ReturnType<typeof loadMorningPromptConfig>>;
  forecast: any;
  natalProfile: any;
  calibration: any | null;
  addressForm?: string | null;
  force: boolean;
}) {
  if (!params.force) {
    const cached = await loadFreshMorningCache(
      params.db,
      params.userId,
      params.forecastDate,
      params.locale,
      params.promptConfig.expectedModel,
    );
    if (cached) {
      return { status: "cache_hit", modelUsed: cached.modelUsed ?? null };
    }
  }

  const petals = buildTopPetals(params.forecast, params.natalProfile, params.calibration, 3);
  if (petals.length < 3) throw new Error("Daily forecast does not contain enough ranked planets");
  const [primary, secondary, tertiary] = petals;
  const mathLevel = buildMathLevelForCron(params.forecast, params.natalProfile, params.calibration, params.locale);
  const addressForm: "ty" | "vy" = params.addressForm === "informal" ? "ty" : "vy";
  const primaryBaseline = baselineForPlanet(primary.planet);
  const secondaryBaseline = baselineForPlanet(secondary.planet);
  const tertiaryBaseline = baselineForPlanet(tertiary.planet);
  const variables = {
    author_voice_block: "",
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
    user_phrases: [],
  };
  const rendered = renderTemplate(params.promptConfig.prompt.template, variables);
  const result = await generateGeminiJson({
    prompt: `${buildOutputLanguageBlock(params.locale)}\n\n${rendered}`,
    modelHint: params.promptConfig.prompt.model_hint,
    temperature: params.promptConfig.prompt.temperature,
    maxOutputTokens: Math.max(params.promptConfig.prompt.max_output_tokens ?? 2200, 6144),
    backgroundRetryPrimary: true,
    logTag: "precompute-daily-forecasts",
  });
  const payload = {
    slogan: String(result.json?.slogan ?? "").trim(),
    short_text: String(result.json?.short_text ?? "").trim(),
    long_explanation: String(result.json?.long_explanation ?? "").trim(),
    math_level: mathLevel,
    modelUsed: result.model,
    [MORNING_CACHE_OUTPUT_LOCALE_KEY]: params.locale,
  };
  const { error } = await params.db.from("scenario_cache").upsert({
    cache_key: morningCacheKey(params.userId, params.forecastDate, params.locale),
    scenario_id: params.promptConfig.scenarioId,
    user_id: params.userId,
    data: payload,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
  return { status: "generated", modelUsed: result.model, tokensUsed: result.tokensUsed ?? null };
}

async function processUser(db: any, chart: any, force: boolean, promptConfig: Awaited<ReturnType<typeof loadMorningPromptConfig>>) {
  const user = chart.users;
  if (!user?.id || typeof user.tz !== "string" || typeof user.lat !== "number" || typeof user.lon !== "number") {
    return { status: "skipped", reason: "missing_location" };
  }
  if (!hasPersonalForecastAccess(user)) {
    return { status: "skipped", reason: "no_personal_forecast_access" };
  }

  const localNow = DateTime.now().setZone(user.tz);
  if (!localNow.isValid) return { status: "skipped", reason: "invalid_timezone" };
  if (!force && localNow.hour !== 0) return { status: "skipped", reason: "outside_local_midnight" };
  if (!force && !(await hasRecentActivity(db, user.id))) return { status: "skipped", reason: "inactive" };

  /** `forecast_date` в БД — календарный день пользователя (IANA `users.tz`), не UTC-полночь. */
  const forecastDate = localNow.toISODate();
  if (!forecastDate) return { status: "skipped", reason: "invalid_date" };
  const locale = normalizeLocale(user.locale);
  const cachedForecast = !force ? await loadFreshForecastCache(db, user.id, forecastDate) : null;
  const cachedMorning = !force
    ? await loadFreshMorningCache(db, user.id, forecastDate, locale, promptConfig.expectedModel)
    : null;
  if (cachedForecast && cachedMorning) {
    return { status: "skipped", reason: "cache_hit" };
  }

  const natalProfile = natalProfileFromRow(chart);
  const calibration = await loadActiveCalibration(db, user.id);

  let forecast = cachedForecast;
  let forecastStatus = cachedForecast ? "cache_hit" : "computed";
  if (!forecast) {
    const recentPlanetsOfDay = await loadRecentPlanets(db, user.id);
    const computed = computeDailyForecast({
      natalProfile,
      calibration,
      forecastDate,
      userLocation: { lat: user.lat, lng: user.lon, timezone: user.tz },
      recentPlanetsOfDay,
    });
    const { error } = await db
      .from("user_daily_forecasts")
      .upsert(dailyForecastToInsert(user.id, user.tz, computed), { onConflict: "user_id,forecast_date" });
    if (error) throw error;
    forecast = computed;
    forecastStatus = "computed";
  }

  const morning = await precomputeMorningRecommendation({
    db,
    userId: user.id,
    forecastDate,
    locale,
    promptConfig,
    forecast,
    natalProfile,
    calibration,
    addressForm: user.address_form ?? null,
    force,
  });

  return {
    status: forecastStatus === "computed" || morning.status === "generated" ? "computed" : "skipped",
    reason: forecastStatus === "cache_hit" && morning.status === "cache_hit" ? "cache_hit" : undefined,
    forecastDate,
    locale,
    planetOfTheDay: forecast.planetOfTheDay ?? forecast.planet_of_the_day,
    forecastStatus,
    morningStatus: morning.status,
    modelUsed: morning.modelUsed ?? null,
  };
}

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    const targetUserId = url.searchParams.get("userId");
    if (targetUserId && !isUuid(targetUserId)) return json({ error: "Invalid userId" }, { status: 400 });

    const db = createServiceClient();
    const promptConfig = await loadMorningPromptConfig(db);
    let query = db
      .from("user_natal_charts")
      .select("*, users!inner(id,tz,lat,lon,onboarded_at,locale,address_form,membership_tier,trial_expires_at)")
      .eq("is_active", true)
      .not("users.lat", "is", null)
      .not("users.lon", "is", null)
      .not("users.tz", "is", null)
      .order("computed_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (targetUserId) query = query.eq("user_id", targetUserId);
    const { data: charts, error } = await query;
    if (error) throw error;

    const results = [];
    for (const chart of charts ?? []) {
      try {
        results.push({ userId: chart.user_id, ...(await processUser(db, chart, force, promptConfig)) });
      } catch (error) {
        console.error("[precompute-daily-forecasts] user failed", chart.user_id, error);
        results.push({ userId: chart.user_id, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }

    return json({
      ok: true,
      processed: results.length,
      computedCount: results.filter((item) => item.status === "computed").length,
      results,
    });
  } catch (error) {
    console.error("[precompute-daily-forecasts]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
