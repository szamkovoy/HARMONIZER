import {
  cityFromLocationName,
  districtCenterFromAdminLabel,
  pickSettlementCity,
  pickUrbanCity,
} from "./geoCity";

/**
 * Nominatim reverse → country + city (prefer town/city over village).
 * Serialized ≤1 req/s; in-memory cell cache.
 *
 * When OSM has only hamlet + «… муниципальный округ», derive the district
 * centre name (Осташковский → Осташков) and confirm via nearby search.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "HARMONIZER/1.0 (geo; contact: sergei@zamkovoi.yoga)";
const MIN_INTERVAL_MS = 1_100;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PRECISION = 2; // ~1 km cells
/** Max distance from GPS to accept a derived/search town as «nearest centre». */
const MAX_CENTRE_KM = 100;

export type GeoPlaceResult = {
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
  hamlet?: string;
  suburb?: string;
  municipality?: string;
  county?: string;
  state?: string;
};

type NominatimResponse = {
  display_name?: string;
  address?: NominatimAddress;
  lat?: string;
  lon?: string;
  type?: string;
  class?: string;
};

const cache = new Map<string, { at: number; place: GeoPlaceResult }>();
let chain: Promise<void> = Promise.resolve();
let lastNominatimAt = 0;

function cellKey(lat: number, lon: number): string {
  return `${lat.toFixed(CACHE_PRECISION)},${lon.toFixed(CACHE_PRECISION)}`;
}

function parseCountry(addr: NominatimAddress): string | null {
  const country_code = addr.country_code?.trim().toUpperCase() || null;
  return country_code && /^[A-Z]{2}$/.test(country_code) ? country_code : null;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function throttle(): Promise<void> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastNominatimAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function fetchNominatimJson(url: URL): Promise<unknown> {
  await throttle();
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
    return res.json();
  }
  throw new Error(`Nominatim unavailable (last HTTP ${lastStatus})`);
}

async function fetchNominatim(
  lat: number,
  lon: number,
  zoom?: number,
): Promise<NominatimResponse> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  if (typeof zoom === "number") url.searchParams.set("zoom", String(zoom));
  return (await fetchNominatimJson(url)) as NominatimResponse;
}

/** Confirm derived centre exists as town/city near the point. */
async function confirmNearbyCentre(
  name: string,
  lat: number,
  lon: number,
  countryCode: string | null,
): Promise<string | null> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", name);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  if (countryCode) url.searchParams.set("countrycodes", countryCode.toLowerCase());

  try {
    const rows = (await fetchNominatimJson(url)) as NominatimResponse[];
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      const rLat = Number(row.lat);
      const rLon = Number(row.lon);
      if (!Number.isFinite(rLat) || !Number.isFinite(rLon)) continue;
      if (haversineKm(lat, lon, rLat, rLon) > MAX_CENTRE_KM) continue;
      const kind = `${row.class ?? ""}:${row.type ?? ""}`;
      const ok =
        kind.includes("city") ||
        kind.includes("town") ||
        kind.includes("municipality") ||
        row.type === "administrative";
      if (!ok) continue;
      const urban =
        pickUrbanCity(row.address ?? {}) ||
        (row.address?.town || row.address?.city || name).trim();
      if (urban && !/муниципальн|округ|район/i.test(urban)) return urban;
      return name;
    }
  } catch {
    return null;
  }
  return null;
}

function adminLabelFromAddr(addr: NominatimAddress): string | null {
  return (addr.municipality || addr.county || "").trim() || null;
}

/** Prefer town/city; derive district centre when OSM only has hamlet + county. */
export async function resolveGeoPlace(lat: number, lon: number): Promise<GeoPlaceResult> {
  const detailed = await fetchNominatim(lat, lon);
  const addr = detailed.address ?? {};
  const location_name =
    detailed.display_name?.trim() ||
    [pickSettlementCity(addr), addr.state, addr.country].filter(Boolean).join(", ") ||
    null;
  const country_code = parseCountry(addr);

  let city = pickUrbanCity(addr);

  if (!city) {
    const urbanLevel = await fetchNominatim(lat, lon, 10);
    const urbanAddr = urbanLevel.address ?? {};
    city = pickUrbanCity(urbanAddr);

    if (!city) {
      const admin =
        adminLabelFromAddr(urbanAddr) ||
        adminLabelFromAddr(addr) ||
        null;
      const derived = districtCenterFromAdminLabel(admin);
      if (derived) {
        const confirmed = await confirmNearbyCentre(
          derived,
          lat,
          lon,
          country_code,
        );
        city = confirmed || derived;
      }
    }

    if (!city) {
      city =
        pickSettlementCity(urbanAddr) ||
        pickSettlementCity(addr) ||
        cityFromLocationName(urbanLevel.display_name) ||
        cityFromLocationName(location_name);
    }
  }

  // Never keep district admin labels as city.
  if (city && /муниципальн|округ|район/i.test(city)) {
    city = districtCenterFromAdminLabel(city) || cityFromLocationName(location_name);
  }

  return {
    country_code,
    city: city || null,
    location_name,
  };
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Cached + rate-limited resolve for API routes. */
export async function resolveGeoPlaceCached(
  lat: number,
  lon: number,
): Promise<{ place: GeoPlaceResult; cached: boolean }> {
  const key = cellKey(lat, lon);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { place: hit.place, cached: true };
  }
  const place = await enqueue(() => resolveGeoPlace(lat, lon));
  cache.set(key, { at: Date.now(), place });
  return { place, cached: false };
}

/** Bust cache after logic changes (admin repair / tests). */
export function clearGeoPlaceCache(): void {
  cache.clear();
}
