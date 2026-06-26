import { getResponseLocale } from "@/modules/i18n/localeStore";
import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import type { DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import { computeWindowsForFreeUser } from "@/modules/daily-engine";
import { getAiGlobalContentUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";
import { normalizeChakraNamesInText } from "@/_legacy_web/app/api/_utils/chakraText";
import { getMathLevelStrings } from "@/_legacy_web/app/api/_utils/mathLevelI18n";

export type AccessMode = "premium" | "trial" | "free";

export interface GlobalContentResult {
  forecast: DailyForecast;
  accessMode: AccessMode;
  isFallback: boolean;
  modelUsed: string | null;
}

type GlobalTopPetal = {
  planet: Planet;
  chakra_number: number;
  chakra_label: string;
  gravity: number;
  tone: "harmonic" | "dissonant" | "ambivalent_strong";
};

type GlobalContentResponse = {
  slogan?: string;
  short_text: string;
  long_explanation?: string;
  math_level?: DailyForecast["mathLevel"];
  primary_planet: Planet;
  primary_tone: "harmonic" | "dissonant" | "ambivalent_strong";
  top_petals: GlobalTopPetal[];
  planet_positions?: unknown;
  forecast_date: string;
  is_fallback?: boolean;
  membership_tier?: "free" | "premium";
  has_premium_access?: boolean;
  trial_expires_at?: string | null;
  llm_model?: string | null;
  error?: unknown;
};

const GLOBAL_CONTENT_TIMEOUT_MS = 25_000;
const GLOBAL_CONTENT_DIRECT_FALLBACK_TIMEOUT_MS = 8_000;

type GlobalTextFields = {
  slogan: string;
  short_text: string;
  long_explanation: string;
};

type GlobalTextI18nMap = Partial<Record<string, GlobalTextFields>>;

const GLOBAL_MATH_SCHEMA_VERSION = 2;
const GLOBAL_ASPECT_COEF: Record<string, number> = {
  conjunction: 1,
  opposition: 0.9,
  square: 0.8,
  trine: 0.7,
  sextile: 0.5,
};
const GLOBAL_TRANSIT_WEIGHT: Record<string, number> = {
  Saturn: 1,
  Jupiter: 0.9,
  Mars: 0.8,
  Sun: 0.7,
  Venus: 0.5,
  Mercury: 0.5,
  Moon: 0.3,
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Mirrors server pickGlobalTexts — reads text_i18n when present, else canonical RU. */
function pickGlobalTextsFromRow(row: Record<string, unknown>, locale: string): GlobalTextFields {
  const ru: GlobalTextFields = {
    slogan: normalizeChakraNamesInText(asTrimmedString(row.slogan), locale as AppContentLocale),
    short_text: normalizeChakraNamesInText(asTrimmedString(row.short_text), locale as AppContentLocale),
    long_explanation: normalizeChakraNamesInText(asTrimmedString(row.long_explanation), locale as AppContentLocale),
  };
  if (locale === "ru") return ru;

  const localized = (row.text_i18n as GlobalTextI18nMap | undefined)?.[locale];
  if (localized?.short_text?.trim()) {
    return {
      slogan: normalizeChakraNamesInText(asTrimmedString(localized.slogan) || ru.slogan, locale as AppContentLocale),
      short_text: normalizeChakraNamesInText(asTrimmedString(localized.short_text), locale as AppContentLocale),
      long_explanation: normalizeChakraNamesInText(
        asTrimmedString(localized.long_explanation) || ru.long_explanation,
        locale as AppContentLocale,
      ),
    };
  }
  return ru;
}

function rebuildLocalizedGlobalMathLevel(
  mathLevel: DailyForecast["mathLevel"] | undefined,
  locale: AppContentLocale,
): DailyForecast["mathLevel"] | undefined {
  const structured = mathLevel?.structured as
    | {
        schema_version?: number;
        chart_mode?: string;
        primary_planet?: string;
        primary_chakra_number?: number;
        primary_tone?: string;
        planet_positions?: Record<string, unknown>;
        aspects?: Array<{ from: string; to: string; type: string; orb: number; maxOrb: number }>;
        top_petals?: Array<{ planet: string; gravity: number; chakra_number: number; tone: string }>;
        planet_scores?: Array<{
          planet: string;
          gravity: number;
          chakra_number: number;
          tone: string;
          sign?: string;
          sign_degree?: number;
        }>;
      }
    | undefined;
  if (!structured || structured.schema_version !== GLOBAL_MATH_SCHEMA_VERSION || structured.chart_mode !== "transit_only") {
    return mathLevel;
  }

  const t = getMathLevelStrings(locale);
  const aspects = Array.isArray(structured.aspects) ? structured.aspects : [];
  const topPetals = Array.isArray(structured.top_petals) ? structured.top_petals : [];
  const planetScores = Array.isArray(structured.planet_scores) ? structured.planet_scores : [];
  const primaryPlanet = structured.primary_planet ?? topPetals[0]?.planet ?? planetScores[0]?.planet ?? "Sun";
  const primaryPetal =
    planetScores.find((planet) => planet.planet === primaryPlanet)
    ?? topPetals.find((planet) => planet.planet === primaryPlanet)
    ?? planetScores[0]
    ?? topPetals[0];

  const markdown = [
    t.globalTitle,
    t.globalIntro,
    t.globalMechanicsLine,
    t.globalSectionWinner,
    t.globalWinnerLine(
      t.planetLabel(primaryPlanet),
      primaryPetal?.chakra_number ?? structured.primary_chakra_number ?? 0,
      t.toneLabel(primaryPetal?.tone ?? structured.primary_tone ?? "neutral"),
      typeof primaryPetal?.gravity === "number" ? primaryPetal.gravity.toFixed(3) : "0.000",
    ),
    t.globalSectionRanking,
    ...planetScores.map((planet, index) =>
      t.globalRankingLine(
        String(index + 1),
        t.planetLabel(planet.planet),
        t.signLabel(planet.sign ?? "Aries"),
        typeof planet.sign_degree === "number" ? planet.sign_degree.toFixed(1) : "0.0",
        planet.gravity.toFixed(3),
        t.toneLabel(planet.tone),
      ),
    ),
    t.globalSectionPetals,
    ...topPetals.map((petal) =>
      t.globalPetalLine(t.planetLabel(petal.planet), petal.gravity, petal.chakra_number, t.toneLabel(petal.tone)),
    ),
    t.globalSectionAspects,
    ...aspects.map((aspect) =>
      t.globalAspectLine(
        t.planetLabel(aspect.from),
        t.aspectLabel(aspect.type),
        t.planetLabel(aspect.to),
        aspect.orb.toFixed(2),
      ),
    ),
    t.globalSectionAspectWeights,
    ...aspects.map((aspect) => {
      const coef = GLOBAL_ASPECT_COEF[aspect.type] ?? 0.5;
      const weightFrom = GLOBAL_TRANSIT_WEIGHT[aspect.from] ?? 0.5;
      const weightTo = GLOBAL_TRANSIT_WEIGHT[aspect.to] ?? 0.5;
      const orbFactor = Math.max(0, 1 - aspect.orb / aspect.maxOrb);
      const contribution = coef * ((weightFrom + weightTo) / 2) * orbFactor;
      return t.globalAspectWeightLine(
        t.planetLabel(aspect.from),
        t.aspectLabel(aspect.type),
        t.planetLabel(aspect.to),
        aspect.orb.toFixed(2),
        contribution.toFixed(3),
      );
    }),
  ].join("\n");

  return {
    ...mathLevel,
    markdown,
  };
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для общего прогноза.");
  return token;
}

function toneFromGlobal(tone: GlobalContentResponse["primary_tone"]): TodayTone {
  if (tone === "harmonic") return "harmonic";
  if (tone === "dissonant") return "dissonant";
  return "neutral";
}

function emptyPlanetMap(): Record<Planet, number> {
  return {
    Sun: 0,
    Moon: 0,
    Mercury: 0,
    Venus: 0,
    Mars: 0,
    Jupiter: 0,
    Saturn: 0,
  };
}

function accessModeFromResponse(data: GlobalContentResponse): AccessMode {
  if (data.membership_tier === "premium") return "premium";
  return data.has_premium_access ? "trial" : "free";
}

function transitPlanetsFromGlobalRow(
  positions: unknown,
): DailyForecast["transitChart"]["planets"] {
  const empty = {} as DailyForecast["transitChart"]["planets"];
  if (!positions || typeof positions !== "object") return empty;
  const src = positions as Record<string, { lon?: number; longitude?: number; speed?: number; isRetrograde?: boolean }>;
  const planets: Partial<DailyForecast["transitChart"]["planets"]> = {};
  for (const p of ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const) {
    const row = src[p];
    if (!row) continue;
    const lon = typeof row.longitude === "number" ? row.longitude : row.lon;
    if (typeof lon !== "number") continue;
    planets[p] = {
      longitude: lon,
      speed: typeof row.speed === "number" ? row.speed : 0,
      isRetrograde: Boolean(row.isRetrograde),
    };
  }
  return planets as DailyForecast["transitChart"]["planets"];
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return new Error(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
  }
  const text = await res.text().catch(() => res.statusText);
  const looksLikeHtml = text.trimStart().startsWith("<!") || /<html[\s>]/i.test(text);
  if (looksLikeHtml) {
    return new Error(`Global content API returned HTML (${res.status}).`);
  }
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

function localDateIso(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function timeoutError(timeoutMs: number): Error {
  return new Error(`Global content request timed out after ${Math.round(timeoutMs / 1000)}s.`);
}

async function fetchGlobalContentDirect(
  timezone: string,
  responseLocale: string,
  signal?: AbortSignal,
): Promise<GlobalContentResponse> {
  const localDate = localDateIso(timezone);
  const db = requireSupabase();
  let primaryQuery = db.from("global_daily_content").select("*").eq("forecast_date_utc", localDate);
  if (signal) {
    primaryQuery = primaryQuery.abortSignal(signal);
  }
  const { data, error } = await primaryQuery.maybeSingle();
  if (error) throw error;

  const content = data as Record<string, unknown> | null;
  if (!content) {
    let fallbackQuery = db
      .from("global_daily_content")
      .select("*")
      .order("forecast_date_utc", { ascending: false })
      .limit(1);
    if (signal) {
      fallbackQuery = fallbackQuery.abortSignal(signal);
    }
    const { data: fallback, error: fallbackError } = await fallbackQuery.maybeSingle();
    if (fallbackError) throw fallbackError;
    if (!fallback) throw new Error("No global content available");
    return globalResponseFromRow(fallback as Record<string, unknown>, true, responseLocale);
  }

  return globalResponseFromRow(content, false, responseLocale);
}

function globalResponseFromRow(
  row: Record<string, unknown>,
  isFallback: boolean,
  responseLocale: string,
): GlobalContentResponse {
  const texts = pickGlobalTextsFromRow(row, responseLocale);
  return {
    slogan: texts.slogan || undefined,
    short_text: texts.short_text,
    long_explanation: texts.long_explanation || undefined,
    math_level: rebuildLocalizedGlobalMathLevel(row.math_level as DailyForecast["mathLevel"], responseLocale as AppContentLocale),
    primary_planet: row.primary_planet as Planet,
    primary_tone: row.primary_tone as GlobalContentResponse["primary_tone"],
    top_petals: (row.top_petals as GlobalTopPetal[]) ?? [],
    planet_positions: row.planet_positions,
    forecast_date: String(row.forecast_date_utc ?? ""),
    llm_model: typeof row.llm_model === "string" ? row.llm_model : null,
    is_fallback: isFallback,
    membership_tier: "free",
    has_premium_access: false,
  };
}

export async function fetchGlobalContent(req: {
  userLocation: { lat: number; lng: number; timezone: string };
  signal?: AbortSignal;
  responseLocale?: string;
}): Promise<GlobalContentResult> {
  return withTransientNetworkRetry(
    async () => fetchGlobalContentOnce(req),
    { signal: req.signal },
  );
}

async function fetchGlobalContentOnce(req: {
  userLocation: { lat: number; lng: number; timezone: string };
  signal?: AbortSignal;
  responseLocale?: string;
}): Promise<GlobalContentResult> {
  const token = await getAccessToken();
  let data: GlobalContentResponse | null = null;
  const responseLocale = req.responseLocale ?? getResponseLocale();
  let routeError: unknown = null;
  try {
    const routeController = new AbortController();
    const routeTimeoutId = setTimeout(() => routeController.abort(), GLOBAL_CONTENT_TIMEOUT_MS);
    req.signal?.addEventListener("abort", () => routeController.abort(), { once: true });
    try {
      const res = await fetch(getAiGlobalContentUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ responseLocale }),
        signal: routeController.signal,
      });
      if (!res.ok) throw await readError(res);
      data = (await res.json()) as GlobalContentResponse;
    } catch (error) {
      if (req.signal?.aborted) throw error;
      routeError = routeController.signal.aborted ? timeoutError(GLOBAL_CONTENT_TIMEOUT_MS) : error;
    } finally {
      clearTimeout(routeTimeoutId);
    }

    if (routeError) {
      const fallbackController = new AbortController();
      const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), GLOBAL_CONTENT_DIRECT_FALLBACK_TIMEOUT_MS);
      req.signal?.addEventListener("abort", () => fallbackController.abort(), { once: true });
      try {
        data = await fetchGlobalContentDirect(req.userLocation.timezone, responseLocale, fallbackController.signal);
      } catch (fallbackError) {
        if (req.signal?.aborted) throw fallbackError;
        if (fallbackController.signal.aborted) {
          throw routeError instanceof Error ? routeError : timeoutError(GLOBAL_CONTENT_TIMEOUT_MS);
        }
        throw wrapConnectivityFailure(fallbackError, "global-content");
      } finally {
        clearTimeout(fallbackTimeoutId);
      }
    }
  } catch (error) {
    if (req.signal?.aborted) throw error;
    throw wrapConnectivityFailure(error, "global-content");
  }
  if (!data) {
    throw wrapConnectivityFailure(routeError ?? new Error("Global content request failed"), "global-content");
  }
  if (data.error) throw new Error(typeof data.error === "string" ? data.error : "Global content request failed");

  const importance = emptyPlanetMap();
  for (const petal of data.top_petals ?? []) {
    importance[petal.planet] = petal.gravity ?? 0;
  }
  const rankedPlanets = [...(data.top_petals ?? [])]
    .sort((a, b) => (b.gravity ?? 0) - (a.gravity ?? 0))
    .map((petal) => petal.planet);
  const windowsOfOpportunity = computeWindowsForFreeUser({
    primaryPlanet: data.primary_planet,
    userLocation: req.userLocation,
    forecastDate: data.forecast_date,
  });

  const forecast: DailyForecast = Object.assign(
    {
      date: data.forecast_date,
      importance,
      activation: importance,
      rankedPlanets: rankedPlanets.length ? rankedPlanets : [data.primary_planet],
      planetOfTheDay: data.primary_planet,
      isAlternativeChoice: false,
      todayPlanetState: {
        naturalHarmoniousness: toneFromGlobal(data.primary_tone) === "harmonic" ? 0.5 : toneFromGlobal(data.primary_tone) === "dissonant" ? -0.5 : 0,
        todayTone: toneFromGlobal(data.primary_tone),
      },
      windowsOfOpportunity,
      transitChart: {
        referenceTime: `${data.forecast_date}T12:00:00Z`,
        planets: transitPlanetsFromGlobalRow(data.planet_positions),
      },
      computedAt: new Date().toISOString(),
      cacheValidUntil: new Date(`${data.forecast_date}T23:59:59.999Z`).toISOString(),
    },
    {
      recommendationShortText: data.short_text,
      recommendationLongText: data.long_explanation,
      slogan: data.slogan,
      mathLevel: data.math_level,
      isGlobal: true,
    },
  );

  return {
    forecast,
    accessMode: accessModeFromResponse(data),
    isFallback: Boolean(data.is_fallback),
    modelUsed: typeof data.llm_model === "string" && data.llm_model.trim() ? data.llm_model.trim() : null,
  };
}
