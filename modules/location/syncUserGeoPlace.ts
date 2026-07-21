/**
 * Фоновая запись country_code + city (Nominatim через /api/geo/reverse).
 * Не блокирует UI. Запрос только если полей нет или сдвиг GPS ≳ 100 км
 * от точки, в которой город уже определяли.
 */
import { fetchReverseGeoPlace } from "@/modules/location/geoReverseClient";
import { getSupabase } from "@/services/supabase";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

/** Существенный переезд — другой город; поездки «дом–работа» не трогаем. */
const SIGNIFICANT_MOVE_KM = 100;
const EARTH_RADIUS_KM = 6371;

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function needsRefresh(params: {
  lat: number;
  lon: number;
  country_code: string | null;
  city: string | null;
  geo_place_lat: number | null;
  geo_place_lon: number | null;
}): boolean {
  if (!params.country_code || !params.city) return true;
  if (params.geo_place_lat == null || params.geo_place_lon == null) return true;
  return (
    haversineKm(params.geo_place_lat, params.geo_place_lon, params.lat, params.lon)
    >= SIGNIFICANT_MOVE_KM
  );
}

async function persistPlace(
  userId: string,
  lat: number,
  lon: number,
): Promise<void> {
  const place = await fetchReverseGeoPlace(lat, lon);
  if (!place || (!place.country_code && !place.city)) return;

  const supabase = getSupabase();
  if (!supabase) return;

  const patch: Record<string, string | number> = {
    geo_place_lat: lat,
    geo_place_lon: lon,
  };
  if (place.country_code) patch.country_code = place.country_code;
  if (place.city) patch.city = place.city;
  if (place.location_name) patch.location_name = place.location_name;

  const { error } = await supabase.from("users").update(patch).eq("id", userId);
  if (error) {
    logRuntimeEvent("location:geo_place_sync_error", { message: error.message }, "warn");
    return;
  }
  logRuntimeEvent(
    "location:geo_place_synced",
    { country: place.country_code, city: place.city, via: "nominatim" },
    "info",
  );
}

/**
 * Best-effort: обновить `users.country_code` / `users.city` без блокировки экрана.
 * Вызывать через `void maybeSyncUserGeoPlace(userId)`.
 */
export async function maybeSyncUserGeoPlace(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("lat, lon, country_code, city, geo_place_lat, geo_place_lon")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return;

    const lat = typeof data.lat === "number" ? data.lat : Number(data.lat);
    const lon = typeof data.lon === "number" ? data.lon : Number(data.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const geoLat =
      data.geo_place_lat == null
        ? null
        : typeof data.geo_place_lat === "number"
          ? data.geo_place_lat
          : Number(data.geo_place_lat);
    const geoLon =
      data.geo_place_lon == null
        ? null
        : typeof data.geo_place_lon === "number"
          ? data.geo_place_lon
          : Number(data.geo_place_lon);

    if (
      !needsRefresh({
        lat,
        lon,
        country_code: data.country_code ?? null,
        city: data.city ?? null,
        geo_place_lat: Number.isFinite(geoLat as number) ? (geoLat as number) : null,
        geo_place_lon: Number.isFinite(geoLon as number) ? (geoLon as number) : null,
      })
    ) {
      return;
    }

    await persistPlace(userId, lat, lon);
  } catch (err) {
    logRuntimeEvent(
      "location:geo_place_sync_error",
      { message: err instanceof Error ? err.message : String(err) },
      "warn",
    );
  }
}

/** После свежего GPS (lat/lon уже в БД): фоном дописать страну/город (порог 100 км). */
export function scheduleGeoPlaceSyncAfterCoords(userId: string): void {
  void maybeSyncUserGeoPlace(userId);
}
