import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";

export type ReverseGeoPlace = {
  country_code: string | null;
  city: string | null;
  location_name: string | null;
};

const TIMEOUT_MS = 12_000;

/** Ближайший город через Vercel-прокси → Nominatim (с серверным rate-limit). */
export async function fetchReverseGeoPlace(
  lat: number,
  lon: number,
): Promise<ReverseGeoPlace | null> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) return null;

  const url = new URL(`${getCommunicatorApiBaseUrl()}/api/geo/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { place?: ReverseGeoPlace };
    return data.place ?? null;
  } finally {
    clearTimeout(timeoutId);
  }
}
