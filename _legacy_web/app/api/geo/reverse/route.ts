import { resolveGeoPlaceCached } from "../../_utils/geoReverseResolve";
import { errorResponse, json, requireUserId } from "../../_utils/supabase";

/**
 * Reverse geocode → ближайший город/районный центр (Nominatim/OSM).
 * Логика: `_utils/geoReverseResolve.ts` (town/city; zoom=10 если только деревня).
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireUserId(req);
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json({ error: "lat/lon required" }, { status: 400 });
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return json({ error: "lat/lon out of range" }, { status: 400 });
    }

    const { place, cached } = await resolveGeoPlaceCached(lat, lon);
    return json({ place, cached });
  } catch (error) {
    return errorResponse(error);
  }
}
