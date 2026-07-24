/**
 * Поиск города рождения (автодополнение) через прокси `/api/geo/search`
 * на Vercel (`_legacy_web/app/api/geo/search`), который ходит в Open-Meteo
 * Geocoding API: бесплатно, мультиязычно (все 8 локалей приложения),
 * возвращает координаты и IANA-таймзону места.
 */
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import {
  getSupabaseAccessToken,
  rememberSupabaseSession,
  requireSupabase,
} from "@/services/supabase";

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

async function fetchGeoSearch(
  url: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<GeoPlace[]> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (res.status === 401) {
    const err = new Error("geo/search HTTP 401");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  if (!res.ok) throw new Error(`geo/search HTTP ${res.status}`);
  const data = (await res.json()) as { places?: GeoPlace[] };
  return Array.isArray(data.places) ? data.places : [];
}

export async function searchBirthPlaces(
  query: string,
  locale: string,
  signal?: AbortSignal,
): Promise<GeoPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = new URL(`${getCommunicatorApiBaseUrl()}/api/geo/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("lang", locale);
  const href = url.toString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    let accessToken = await getSupabaseAccessToken();
    if (!accessToken) throw new Error("Auth session required for geo search.");

    try {
      return await fetchGeoSearch(href, accessToken, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) throw err;
      // Протухший JWT — один refresh + retry (и кладём сессию в снимок).
      if (!(err instanceof Error) || !("status" in err) || (err as { status?: number }).status !== 401) {
        throw err;
      }
      const { data, error } = await requireSupabase().auth.refreshSession();
      if (error || !data.session?.access_token) throw err;
      rememberSupabaseSession(data.session);
      accessToken = data.session.access_token;
      return await fetchGeoSearch(href, accessToken, controller.signal);
    }
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}
