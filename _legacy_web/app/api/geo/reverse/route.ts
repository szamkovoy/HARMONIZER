import { errorResponse, json, requireUserId } from "../../_utils/supabase";

/**
 * Reverse geocode → ближайший город (Nominatim/OSM).
 * Лимит публичного Nominatim: ≤1 req/s на приложение — сериализуем + кэш.
 */
export const runtime = "nodejs";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "HARMONIZER/1.0 (geo; contact: sergei@zamkovoi.yoga)";
const MIN_INTERVAL_MS = 1_100;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PRECISION = 2; // ~1 km cells

type PlaceResult = {
  country_code: string | null;
  city: string | null;
  location_name: string | null;
};

type NominatimAddress = {
  country_code?: string;
  country?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
};

type NominatimResponse = {
  display_name?: string;
  address?: NominatimAddress;
};

const cache = new Map<string, { at: number; place: PlaceResult }>();
let chain: Promise<void> = Promise.resolve();
let lastNominatimAt = 0;

function cellKey(lat: number, lon: number): string {
  return `${lat.toFixed(CACHE_PRECISION)},${lon.toFixed(CACHE_PRECISION)}`;
}

function pickCity(addr: NominatimAddress): string | null {
  const raw = (addr.town || addr.city || addr.village || "").trim();
  if (raw) return raw;
  // municipality/county часто «городской округ …» — только если нет town/city
  const fallback = (addr.municipality || addr.county || "").trim();
  return fallback || null;
}

function parsePlace(data: NominatimResponse): PlaceResult {
  const addr = data.address ?? {};
  const country_code = addr.country_code?.trim().toUpperCase() || null;
  const city = pickCity(addr);
  const location_name =
    data.display_name?.trim()
    || [city, addr.state, addr.country].filter(Boolean).join(", ")
    || null;
  return {
    country_code: country_code && /^[A-Z]{2}$/.test(country_code) ? country_code : null,
    city,
    location_name,
  };
}

async function fetchNominatim(lat: number, lon: number): Promise<PlaceResult> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastNominatimAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");

  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
    lastNominatimAt = Date.now();
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    lastStatus = res.status;
    if (res.status === 429 || res.status >= 500) continue;
    if (!res.ok) {
      throw new Error(`Nominatim HTTP ${res.status}`);
    }
    const data = (await res.json()) as NominatimResponse;
    return parsePlace(data);
  }
  throw new Error(`Nominatim unavailable (last HTTP ${lastStatus})`);
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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

    const key = cellKey(lat, lon);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return json({ place: hit.place, cached: true });
    }

    const place = await enqueue(() => fetchNominatim(lat, lon));
    cache.set(key, { at: Date.now(), place });
    return json({ place, cached: false });
  } catch (error) {
    return errorResponse(error);
  }
}
