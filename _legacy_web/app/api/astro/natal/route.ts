import { computeNatalProfileWithAstronomia, type BirthData } from "../../../../modules/astro-core";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { nextVersionFor } from "../../_utils/astro-db";
import { todayLocalDate } from "../../calibration/extract/forecast-cache-date";

// Запись в user_natal_charts только через service_role (RLS: владелец — SELECT).
export const runtime = "nodejs";

type Body = {
  birthData: BirthData;
  /** «Город, область, страна» из автодополнения (Open-Meteo); null для legacy-клиентов. */
  birthPlaceName?: string | null;
};

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    if (!body.birthData) {
      return json({ error: "birthData is required" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const profile = await computeNatalProfileWithAstronomia(body.birthData);
    const version = await nextVersionFor(db, "user_natal_charts", userId);
    const birthPlace = {
      name: body.birthPlaceName?.trim() || null,
      lat: body.birthData.location.lat,
      lon: body.birthData.location.lng,
      timezone: body.birthData.location.timezone,
    };

    const { data: userRow, error: userLoadError } = await db
      .from("users")
      .select("lat,lon,tz,location_name")
      .eq("id", userId)
      .maybeSingle();
    if (userLoadError) throw userLoadError;

    const { error: deactivateError } = await db
      .from("user_natal_charts")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("is_active", true);
    if (deactivateError) throw deactivateError;

    const { data, error } = await db
      .from("user_natal_charts")
      .insert({
        user_id: userId,
        version,
        is_active: true,
        precision_mode: profile.precisionMode,
        is_day_chart: profile.isDayChart,
        ascendant_longitude: profile.ascendant?.longitude ?? null,
        house_system: profile.houseSystem,
        planets: profile.planets,
        ephemeris_lib_version: profile.ephemerisLibVersion,
        computed_at: profile.computedAt,
      })
      .select("*")
      .single();
    if (error) throw error;

    const { error: userUpdateError } = await db
      .from("users")
      .update({
        birth_date: body.birthData.date,
        birth_time: body.birthData.timeMode === "unknown" ? null : body.birthData.time ?? null,
        birth_place: birthPlace,
        lat: userRow?.lat ?? body.birthData.location.lat,
        lon: userRow?.lon ?? body.birthData.location.lng,
        tz: userRow?.tz ?? body.birthData.location.timezone,
        location_name: userRow?.location_name ?? birthPlace.name,
      })
      .eq("id", userId);
    if (userUpdateError) throw userUpdateError;

    const forecastDate = todayLocalDate(userRow?.tz ?? body.birthData.location.timezone);
    // Инвалидация дня: числовой прогноз (user_daily_forecasts) И LLM-тексты
    // (scenario_cache morning_recommendation). Раньше чистили только forecasts —
    // диаграмма обновлялась (новый натал), а слоган/рекомендация оставались
    // от старой планеты дня (ключ кэша = user+date+locale, без fingerprint натала).
    const { error: cacheError } = await db
      .from("user_daily_forecasts")
      .delete()
      .eq("user_id", userId)
      .gte("forecast_date", forecastDate);
    if (cacheError) throw cacheError;

    const { error: morningCacheError } = await db
      .from("scenario_cache")
      .delete()
      .eq("user_id", userId)
      .eq("scenario_id", "morning_recommendation");
    if (morningCacheError) throw morningCacheError;

    return json({ natalChart: data, profile });
  } catch (error) {
    return errorResponse(error);
  }
}
