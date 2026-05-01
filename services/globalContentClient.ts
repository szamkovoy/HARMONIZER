import type { DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import { computeWindowsForFreeUser, type FreeUserTopAspect } from "@/modules/daily-engine";
import { getAiGlobalContentUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

export type AccessMode = "premium" | "trial" | "free";

export interface GlobalContentResult {
  forecast: DailyForecast;
  accessMode: AccessMode;
  isFallback: boolean;
}

type GlobalTopPetal = {
  planet: Planet;
  chakra_number: number;
  chakra_label: string;
  gravity: number;
  tone: "harmonic" | "dissonant" | "ambivalent_strong";
  main_aspects?: FreeUserTopAspect[];
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
  error?: unknown;
};

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

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return new Error(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
  }
  const text = await res.text().catch(() => res.statusText);
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

export async function fetchGlobalContent(req: {
  userLocation: { lat: number; lng: number; timezone: string };
  signal?: AbortSignal;
}): Promise<GlobalContentResult> {
  const token = await getAccessToken();
  const res = await fetch(getAiGlobalContentUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: "{}",
    signal: req.signal,
  });
  if (!res.ok) throw await readError(res);

  const data = (await res.json()) as GlobalContentResponse;
  if (data.error) throw new Error(typeof data.error === "string" ? data.error : "Global content request failed");

  const importance = emptyPlanetMap();
  for (const petal of data.top_petals ?? []) {
    importance[petal.planet] = petal.gravity ?? 0;
  }
  const rankedPlanets = [...(data.top_petals ?? [])]
    .sort((a, b) => (b.gravity ?? 0) - (a.gravity ?? 0))
    .map((petal) => petal.planet);
  const topAspect = data.top_petals?.[0]?.main_aspects?.[0] ?? null;
  const windowsOfOpportunity = computeWindowsForFreeUser({
    primaryPlanet: data.primary_planet,
    topAspect,
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
        planets: {} as DailyForecast["transitChart"]["planets"],
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
  };
}
