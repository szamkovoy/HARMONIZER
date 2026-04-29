// @ts-nocheck
/**
 * POST: дневной прогноз M2.
 * Повторяет контракт `_legacy_web/app/api/astro/daily-forecast/route.ts`.
 *
 * В remote-схеме сейчас есть только глобальная `daily_forecasts`.
 * Поэтому функция не пишет M2 payload в БД: структура
 * `daily_forecasts` (`slogan_template`, `long_text_template`, `chakras`,
 * `astro_summary`) несовместима с персональными полями прогноза.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLANETS_7 = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;
const FALLBACK_PLANETS = ["Sun", "Moon", "Venus", "Mercury", "Jupiter", "Mars", "Saturn"] as const;

type Planet = (typeof PLANETS_7)[number];

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

function isOptions(req: Request): boolean {
  return req.method === "OPTIONS";
}

function supabaseEnv() {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    throw json({ error: "Server misconfiguration" }, { status: 500 });
  }
  return { url, anon, service };
}

function errorMessage(value: unknown): string {
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
      return "Unknown daily-forecast error";
    }
  }
  return "Unknown daily-forecast error";
}

function todayLocalDate(timezone: string, at: Date = new Date()): string {
  const tz = timezone?.trim() || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const text = [candidate.message, candidate.details, candidate.hint]
    .map((item) => (typeof item === "string" ? item : ""))
    .join(" ")
    .toLowerCase();

  return (
    code === "PGRST205" ||
    code === "42P01" ||
    text.includes("could not find the table") ||
    text.includes("schema cache") ||
    text.includes("does not exist")
  );
}

function emptyPlanetMap(activePlanet: Planet): Record<Planet, number> {
  return Object.fromEntries(
    PLANETS_7.map((planet) => [planet, planet === activePlanet ? 1 : 0.2]),
  ) as Record<Planet, number>;
}

function planetForDate(forecastDate: string): Planet {
  const date = new Date(`${forecastDate}T00:00:00Z`);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const ordinal = Number.isFinite(date.getTime())
    ? Math.floor((date.getTime() - start.getTime()) / 86_400_000)
    : new Date().getUTCDate();
  return FALLBACK_PLANETS[ordinal % FALLBACK_PLANETS.length];
}

function fallbackForecastPayload(params: {
  forecastDate: string;
  timezone: string;
  globalForecast: any | null;
}) {
  const planetOfTheDay = planetForDate(params.forecastDate);
  const importance = emptyPlanetMap(planetOfTheDay);
  const rankedPlanets = [...PLANETS_7].sort((a, b) => importance[b] - importance[a]);
  const referenceTime = `${params.forecastDate}T14:00:00`;
  const shortText =
    typeof params.globalForecast?.slogan_template?.ru === "string"
      ? params.globalForecast.slogan_template.ru
      : typeof params.globalForecast?.slogan_template === "string"
        ? params.globalForecast.slogan_template
        : undefined;
  const longText =
    typeof params.globalForecast?.long_text_template?.ru === "string"
      ? params.globalForecast.long_text_template.ru
      : typeof params.globalForecast?.long_text_template === "string"
        ? params.globalForecast.long_text_template
        : undefined;

  return {
    date: params.forecastDate,
    importance,
    activation: importance,
    rankedPlanets,
    planetOfTheDay,
    isAlternativeChoice: false,
    todayPlanetState: {
      naturalHarmoniousness: 0,
      todayTone: "neutral",
    },
    windowsOfOpportunity: {
      sunrise: null,
      culmination: null,
      exactAspect: null,
    },
    transitChart: {
      referenceTime,
      planets: Object.fromEntries(
        PLANETS_7.map((planet) => [
          planet,
          { longitude: 0, speed: 0, isRetrograde: false },
        ]),
      ),
    },
    computedAt: new Date().toISOString(),
    cacheValidUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    recommendationShortText: shortText,
    recommendationLongText: longText,
  };
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

async function requireUserId(req: Request): Promise<string> {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) {
    throw json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, anon, service } = supabaseEnv();
  const diagnosticUserId = req.headers.get("x-user-id")?.trim();
  if (token === service && diagnosticUserId) {
    return diagnosticUserId;
  }

  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw json({ error: "Unauthorized" }, { status: 401 });
  }
  const data = await res.json();
  if (!data?.id) throw json({ error: "Unauthorized" }, { status: 401 });
  return data.id;
}

async function restSelect(table: string, query: string): Promise<any[]> {
  const { url, service } = supabaseEnv();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw data ?? new Error(`REST ${res.status}`);
  return Array.isArray(data) ? data : data ? [data] : [];
}

async function maybeSingle(table: string, query: string): Promise<any | null> {
  const rows = await restSelect(table, `${query}&limit=1`);
  return rows[0] ?? null;
}

async function loadRecentPlanets(userId: string): Promise<string[]> {
  const data = await maybeSingle(
    "user_settings",
    `select=preferences&user_id=eq.${encodeURIComponent(userId)}`,
  );
  const recent = data?.preferences?.recentPlanetsOfDay;
  return Array.isArray(recent) ? recent.slice(0, 2) : [];
}

async function loadActiveCalibration(userId: string) {
  try {
    const data = await maybeSingle(
      "user_calibrations",
      `select=s_calibrated,h_calibrated&user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true`,
    );
    if (!data) return null;
    return {
      s_calibrated: data.s_calibrated,
      h_calibrated: data.h_calibrated,
    };
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

async function loadActiveNatalProfile(userId: string) {
  try {
    const data = await maybeSingle(
      "user_natal_charts",
      `select=*&user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true`,
    );
    if (!data) return null;
    return { profile: natalProfileFromRow(data) };
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

async function loadGlobalForecastSummary(forecastDate: string): Promise<unknown | null> {
  return maybeSingle(
    "daily_forecasts",
    [
      "select=forecast_date,slogan_template,long_text_template,chakras,astro_summary,personalization_version,generated_at,model",
      `forecast_date=eq.${encodeURIComponent(forecastDate)}`,
    ].join("&"),
  );
}

Deno.serve(async (req) => {
  if (isOptions(req)) {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as {
      forecastDate?: string;
      userLocation?: { lat: number; lng: number; timezone: string };
      recentPlanetsOfDay?: string[];
      forceRefresh?: boolean;
    };

    if (!body.userLocation) {
      return json({ error: "userLocation is required" }, { status: 400 });
    }

    const forecastDate = body.forecastDate ?? todayLocalDate(body.userLocation.timezone);
    const globalForecast = body.forceRefresh ? null : await loadGlobalForecastSummary(forecastDate);

    const [natal, calibration, recentPlanetsOfDay] = await Promise.all([
      loadActiveNatalProfile(userId),
      loadActiveCalibration(userId),
      body.recentPlanetsOfDay ? Promise.resolve(body.recentPlanetsOfDay.slice(0, 2)) : loadRecentPlanets(userId),
    ]);

    const fallbackReason = natal
      ? "full M2 engine is disabled in Edge until remote M1/M2 tables are migrated"
      : "user_natal_charts table or active natal profile is unavailable";

    return json({
      source: globalForecast ? "cache" : "computed",
      forecast: globalForecast ?? { forecast_date: forecastDate },
      forecastPayload: fallbackForecastPayload({
        forecastDate,
        timezone: body.userLocation.timezone,
        globalForecast,
      }),
      diagnostics: {
        mode: "schema_fallback",
        reason: fallbackReason,
        recentPlanetsOfDay,
        hasCalibration: Boolean(calibration),
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = errorMessage(error);
    console.error("[daily-forecast]", message, error);
    return json({ error: message }, { status: 500 });
  }
});
