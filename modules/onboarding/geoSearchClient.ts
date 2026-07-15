/**
 * Поиск города рождения (автодополнение) через прокси `/api/geo/search`
 * на Vercel (`_legacy_web/app/api/geo/search`), который ходит в Open-Meteo
 * Geocoding API: бесплатно, мультиязычно (все 8 локалей приложения),
 * возвращает координаты и IANA-таймзону места.
 */
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";

export interface GeoPlace {
  id: string;
  /** Название города на локали запроса. */
  name: string;
  /** Регион/область (для различения одноимённых городов). */
  region: string | null;
  /** Страна на локали запроса. */
  country: string | null;
  lat: number;
  lng: number;
  /** IANA-таймзона места — местное время рождения считается в ней. */
  timezone: string;
}

/** «Город, область, страна» для выпадающего списка. */
export function formatGeoPlaceLabel(place: GeoPlace): string {
  return [place.name, place.region, place.country].filter(Boolean).join(", ");
}

const SEARCH_TIMEOUT_MS = 8_000;

export async function searchBirthPlaces(
  query: string,
  locale: string,
  signal?: AbortSignal,
): Promise<GeoPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) throw new Error("Auth session required for geo search.");

  const url = new URL(`${getCommunicatorApiBaseUrl()}/api/geo/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("lang", locale);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`geo/search HTTP ${res.status}`);
    const data = (await res.json()) as { places?: GeoPlace[] };
    return Array.isArray(data.places) ? data.places : [];
  } finally {
    clearTimeout(timeoutId);
  }
}
