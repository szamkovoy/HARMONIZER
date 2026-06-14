import { getResponseLocale } from "@/modules/i18n/localeStore";
import type { DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import { computeWindowsForFreeUser } from "@/modules/daily-engine";
import { getAiGlobalContentUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";

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

const GLOBAL_CONTENT_TIMEOUT_MS = 15_000;

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

async function fetchGlobalContentDirect(timezone: string, signal?: AbortSignal): Promise<GlobalContentResponse> {
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
    return globalResponseFromRow(fallback as Record<string, unknown>, true);
  }

  return globalResponseFromRow(content, false);
}

function globalResponseFromRow(row: Record<string, unknown>, isFallback: boolean): GlobalContentResponse {
  return {
    slogan: typeof row.slogan === "string" ? row.slogan : undefined,
    short_text: typeof row.short_text === "string" ? row.short_text : "",
    long_explanation: typeof row.long_explanation === "string" ? row.long_explanation : undefined,
    math_level: row.math_level as DailyForecast["mathLevel"],
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GLOBAL_CONTENT_TIMEOUT_MS);
  req.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  let data: GlobalContentResponse;
  const responseLocale = req.responseLocale ?? getResponseLocale();
  try {
    try {
      const res = await fetch(getAiGlobalContentUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ responseLocale }),
        signal: controller.signal,
      });
      if (!res.ok) throw await readError(res);
      data = (await res.json()) as GlobalContentResponse;
    } catch (error) {
      if (req.signal?.aborted) throw error;
      if (controller.signal.aborted) throw timeoutError(GLOBAL_CONTENT_TIMEOUT_MS);
      if (responseLocale !== "ru") {
        throw wrapConnectivityFailure(error, "global-content");
      }
      data = await fetchGlobalContentDirect(req.userLocation.timezone, controller.signal);
    }
  } catch (error) {
    if (req.signal?.aborted) throw error;
    if (controller.signal.aborted) throw timeoutError(GLOBAL_CONTENT_TIMEOUT_MS);
    throw wrapConnectivityFailure(error, "global-content");
  } finally {
    clearTimeout(timeoutId);
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
