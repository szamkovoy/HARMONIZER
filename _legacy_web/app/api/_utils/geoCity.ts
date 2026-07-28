/**
 * Prefer a real settlement name over municipality/county ("… муниципальный округ").
 * Prefer town/city (районный / областной центр) over village/hamlet.
 */

const DISTRICT_RE =
  /муниципальн|городск(ой|ого|ая|ую)\s+округ|район|округ|municipality|county|district|borough|община/i;

export function looksLikeDistrictName(value: string | null | undefined): boolean {
  const t = (value ?? "").trim();
  if (!t) return false;
  return DISTRICT_RE.test(t);
}

export type GeoAddressParts = {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  suburb?: string;
  municipality?: string;
  county?: string;
};

function cleanCandidate(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  if (!t || looksLikeDistrictName(t)) return null;
  return t;
}

/** Town / city only — районный или областной центр, не деревня. */
export function pickUrbanCity(addr: GeoAddressParts): string | null {
  return cleanCandidate(addr.town) || cleanCandidate(addr.city);
}

/** Any settlement; urban first, then village/hamlet (never district labels). */
export function pickSettlementCity(addr: GeoAddressParts): string | null {
  return (
    pickUrbanCity(addr) ||
    cleanCandidate(addr.village) ||
    cleanCandidate(addr.hamlet) ||
    cleanCandidate(addr.suburb) ||
    cleanCandidate(addr.municipality) ||
    cleanCandidate(addr.county)
  );
}

/**
 * Scan comma-segments of location_name for a non-district settlement.
 * Prefer later urban-looking tokens when the first is a village head.
 * "Осташков, Осташковский муниципальный округ, …" → "Осташков"
 */
export function cityFromLocationName(
  locationName: string | null | undefined,
): string | null {
  const raw = (locationName ?? "").trim();
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (part.length > 80) continue;
    if (looksLikeDistrictName(part)) continue;
    // Skip country-only tokens
    if (/^(россия|russia|рф)$/i.test(part)) continue;
    return part;
  }
  return null;
}

/** Prefer urban city; fall back to location_name / existing city. */
export function repairCityField(opts: {
  city: string | null | undefined;
  location_name: string | null | undefined;
}): string | null {
  const city = (opts.city ?? "").trim() || null;
  if (city && !looksLikeDistrictName(city)) return city;
  return cityFromLocationName(opts.location_name) ?? city;
}

/** location_name hints that reverse landed on a village inside a district. */
export function locationSuggestsDistrictContext(
  locationName: string | null | undefined,
): boolean {
  return DISTRICT_RE.test(locationName ?? "");
}

/**
 * «Осташковский муниципальный округ» / «Клинский район» → «Осташков» / «Клин».
 * Nominatim often returns only county/municipality without town/city.
 * (JS `\w` / `\b` are ASCII-only — do not use them on Cyrillic.)
 */
export function districtCenterFromAdminLabel(
  label: string | null | undefined,
): string | null {
  const t = (label ?? "").trim();
  if (!t || !looksLikeDistrictName(t)) return null;
  const first = t.split(/[\s,]+/)[0] ?? "";
  const m = first.match(/^(.+)(?:ский|цкий|ской)$/i);
  if (!m?.[1]) return null;
  const base = m[1].trim();
  if (base.length < 2 || base.length > 48) return null;
  if (looksLikeDistrictName(base)) return null;
  return base;
}
