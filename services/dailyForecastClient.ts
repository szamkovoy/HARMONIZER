import type { DailyForecast, Planet } from "@/modules/daily-engine";
import { getDailyForecastUrl } from "@/services/communicatorConfig";
import { DAY_CONTENT_LLM_TIMEOUT_MS } from "@/services/dayContentTimeouts";
import { getSupabaseAccessToken } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";

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
  responseLocale?: string;
  signal?: AbortSignal;
  /**
   * Переопределение клиентского HTTP-таймаута.
   * По умолчанию: 25s (cache/structural); при `forceRefresh` — `DAY_CONTENT_LLM_TIMEOUT_MS` (120s).
   */
  timeoutMs?: number;
}

export interface DailyForecastResult {
  source: ForecastSource;
  forecast: DailyForecast;
  modelUsed: string | null;
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
  slogan?: string | null;
  mathLevel?: DailyForecast["mathLevel"] | null;
  math_level?: DailyForecast["mathLevel"] | null;
  computed_at?: string;
  cache_valid_until?: string;
};

type DailyForecastResponse = {
  source?: ForecastSource;
  forecast?: ForecastPayload;
  forecastPayload?: ForecastPayload;
  modelUsed?: string | null;
  error?: unknown;
};

/** Быстрый путь: кэш / structural каркас без ожидания LLM. */
const DAILY_FORECAST_TIMEOUT_MS = 25_000;
/** Онбординг / LLM-пути — тот же бюджет, что смена языка и monologue. */
export const ONBOARDING_DAILY_FORECAST_TIMEOUT_MS = DAY_CONTENT_LLM_TIMEOUT_MS;

async function getAccessToken(): Promise<string> {
  try {
    return await getSupabaseAccessToken();
  } catch {
    throw new Error("Нужна авторизация Supabase для прогноза дня.");
  }
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return new Error(errorMessage(data?.error, `HTTP ${res.status}`));
  }
  const text = await res.text().catch(() => res.statusText);
  const looksLikeHtml = text.trimStart().startsWith("<!") || /<html[\s>]/i.test(text);
  if (looksLikeHtml) {
    return new Error(`Сервер вернул HTML вместо прогноза (${res.status}). Проверьте деплой Vercel API.`);
  }
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

function errorMessage(value: unknown, fallback = "Unknown error"): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const error = value as { message?: unknown; error?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = [error.message, error.error, error.details, error.hint, error.code]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (message) return message;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
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
    slogan: raw.slogan ?? undefined,
    mathLevel: raw.mathLevel ?? raw.math_level ?? undefined,
  });
}

export async function fetchDailyForecast(req: DailyForecastRequest): Promise<DailyForecastResult> {
  return withTransientNetworkRetry(
    async () => {
      const token = await getAccessToken();
      const url = getDailyForecastUrl();
      const timeoutMs =
        typeof req.timeoutMs === "number" && req.timeoutMs > 0
          ? req.timeoutMs
          : req.forceRefresh === true
            ? DAY_CONTENT_LLM_TIMEOUT_MS
            : DAILY_FORECAST_TIMEOUT_MS;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      req.signal?.addEventListener("abort", () => controller.abort(), { once: true });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      /** Supabase Functions gateway ожидает `apikey` вместе с JWT пользователя. */
      if (url.includes("/functions/v1/")) {
        const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
        if (anon) headers.apikey = anon;
      }

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            forecastDate: req.forecastDate,
            userLocation: req.userLocation,
            recentPlanetsOfDay: req.recentPlanetsOfDay,
            forceRefresh: req.forceRefresh,
            responseLocale: req.responseLocale,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted && !req.signal?.aborted) {
          throw new Error(`Daily forecast request timed out after ${Math.round(timeoutMs / 1000)}s.`);
        }
        throw wrapConnectivityFailure(error, "daily-forecast");
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) throw await readError(res);
      const data = (await res.json()) as DailyForecastResponse;
      if (data.error) throw new Error(errorMessage(data.error, "DailyForecast: server returned an error"));
      const raw = data.forecastPayload
        ? { ...(data.forecast ?? {}), ...data.forecastPayload }
        : data.forecast;
      if (!raw) throw new Error("DailyForecast: empty response");

      return {
        source: data.source ?? "computed",
        forecast: normalizeForecast(raw),
        modelUsed: typeof data.modelUsed === "string" && data.modelUsed.trim() ? data.modelUsed.trim() : null,
      };
    },
    { signal: req.signal },
  );
}
