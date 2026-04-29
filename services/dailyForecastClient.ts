import type { DailyForecast, Planet } from "@/modules/daily-engine";
import { getDailyForecastUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

type ForecastSource = "cache" | "computed";

export interface DailyForecastRequest {
  forecastDate?: string;
  userLocation: {
    lat: number;
    lng: number;
    timezone: string;
  };
  recentPlanetsOfDay?: Planet[];
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export interface DailyForecastResult {
  source: ForecastSource;
  forecast: DailyForecast;
}

type ForecastPayload = Partial<DailyForecast> & {
  forecast_date?: string;
  ranked_planets?: Planet[];
  planet_of_the_day?: Planet;
  is_alternative_choice?: boolean;
  alternative_reason_text?: string | null;
  today_planet_state?: DailyForecast["todayPlanetState"];
  windows_of_opportunity?: DailyForecast["windowsOfOpportunity"];
  transit_chart?: DailyForecast["transitChart"];
  recommendationShortText?: string | null;
  recommendation_short_text?: string | null;
  recommendationLongText?: string | null;
  recommendation_long_text?: string | null;
  computed_at?: string;
  cache_valid_until?: string;
};

type DailyForecastResponse = {
  source?: ForecastSource;
  forecast?: ForecastPayload;
  forecastPayload?: ForecastPayload;
  error?: string;
};

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для прогноза дня.");
  return token;
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return new Error(data?.error ?? `HTTP ${res.status}`);
  }
  const text = await res.text().catch(() => res.statusText);
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`DailyForecast: missing ${label}`);
  return value;
}

function normalizeForecast(raw: ForecastPayload): DailyForecast {
  const forecast: DailyForecast = {
    date: required(raw.date ?? raw.forecast_date, "date"),
    importance: required(raw.importance, "importance") as DailyForecast["importance"],
    activation: required(raw.activation, "activation") as DailyForecast["activation"],
    rankedPlanets: required(raw.rankedPlanets ?? raw.ranked_planets, "rankedPlanets") as Planet[],
    planetOfTheDay: required(raw.planetOfTheDay ?? raw.planet_of_the_day, "planetOfTheDay") as Planet,
    isAlternativeChoice: Boolean(raw.isAlternativeChoice ?? raw.is_alternative_choice),
    alternativeReasonText: raw.alternativeReasonText ?? raw.alternative_reason_text ?? undefined,
    todayPlanetState: required(
      raw.todayPlanetState ?? raw.today_planet_state,
      "todayPlanetState",
    ) as DailyForecast["todayPlanetState"],
    windowsOfOpportunity: required(
      raw.windowsOfOpportunity ?? raw.windows_of_opportunity,
      "windowsOfOpportunity",
    ) as DailyForecast["windowsOfOpportunity"],
    transitChart: required(raw.transitChart ?? raw.transit_chart, "transitChart") as DailyForecast["transitChart"],
    computedAt: required(raw.computedAt ?? raw.computed_at, "computedAt"),
    cacheValidUntil: required(raw.cacheValidUntil ?? raw.cache_valid_until, "cacheValidUntil"),
  };

  return Object.assign(forecast, {
    recommendationShortText: raw.recommendationShortText ?? raw.recommendation_short_text ?? undefined,
    recommendationLongText: raw.recommendationLongText ?? raw.recommendation_long_text ?? undefined,
  });
}

export async function fetchDailyForecast(req: DailyForecastRequest): Promise<DailyForecastResult> {
  const token = await getAccessToken();
  const res = await fetch(getDailyForecastUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      forecastDate: req.forecastDate,
      userLocation: req.userLocation,
      recentPlanetsOfDay: req.recentPlanetsOfDay,
      forceRefresh: req.forceRefresh,
    }),
    signal: req.signal,
  });

  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as DailyForecastResponse;
  if (data.error) throw new Error(data.error);
  const raw = data.forecastPayload
    ? { ...(data.forecast ?? {}), ...data.forecastPayload }
    : data.forecast;
  if (!raw) throw new Error("DailyForecast: empty response");

  return {
    source: data.source ?? "computed",
    forecast: normalizeForecast(raw),
  };
}
