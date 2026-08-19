/**
 * Валюта и страна биллинга Личного кабинета.
 *
 * Правило продукта: Россия -> RUB + country RU; США -> USD; иначе EUR.
 * Страна (ISO) уходит в кабинет для выбора платёжного шлюза (RU/INT).
 *
 * Источник страны при открытии кабинета:
 *   1) `users.country_code` — только GPS/Nominatim. Если пользователь хоть раз
 *      разрешал геолокацию, поле остаётся (не обнуляется при позднем отказе).
 *   2) иначе публичный IP устройства (`GET /api/geo/ip-country`) — только для
 *      этой сессии кабинета. IP никогда не пишется в `users.country_code`
 *      (VPN не должен засорять GPS-поле).
 *
 * Timeout 800 мс не должен «залипать» как EUR в персисте — иначе кабинет
 * навсегда открывается с Lava/EUR, даже когда в профиле уже RU.
 */
import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import {
  currencyForCountry,
  pickCabinetCountry,
  type CabinetCountrySource,
} from "@/modules/account/core/cabinetCountry";
import { fetchIpCountry } from "@/modules/location/ipCountryClient";
import { getSupabase } from "@/services/supabase";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

export type BillingCurrency = "RUB" | "USD" | "EUR";

export type { CabinetCountrySource };
export { pickCabinetCountry, currencyForCountry };

export type BillingGeo = {
  currency: BillingCurrency;
  /** ISO-3166 alpha-2; empty if unknown. */
  country: string;
};

type ResolvedBillingGeo = {
  geo: BillingGeo;
  source: CabinetCountrySource;
};

const GEO_TIMEOUT_MS = 800;
const PERSIST_CURRENCY_KEY = "billingCurrency";
const PERSIST_COUNTRY_KEY = "billingCountry";
const PERSIST_SOURCE_KEY = "billingCountrySource";

/** Кэш на сессию — только GPS-страна из профиля. */
let cachedGeo: BillingGeo | null = null;

function isBillingCurrency(value: string | null | undefined): value is BillingCurrency {
  return value === "RUB" || value === "USD" || value === "EUR";
}

function normalizeCountry(raw: string | null | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function geoFromCountry(country: string): BillingGeo {
  return { currency: currencyForCountry(country), country };
}

async function persistProfileGeo(geo: BillingGeo): Promise<void> {
  if (!geo.country) return;
  cachedGeo = geo;
  await writeAccountFlag(PERSIST_CURRENCY_KEY, geo.currency);
  await writeAccountFlag(PERSIST_COUNTRY_KEY, geo.country);
  await writeAccountFlag(PERSIST_SOURCE_KEY, "profile");
}

async function loadProfileCountry(userId: string | null): Promise<string> {
  if (!userId) return "";
  const supabase = getSupabase();
  if (!supabase) return "";
  try {
    const { data, error } = await supabase
      .from("users")
      .select("country_code")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return "";
    return normalizeCountry(data.country_code);
  } catch {
    return "";
  }
}

async function resolveFromGeo(userId: string | null): Promise<ResolvedBillingGeo> {
  const profileCountry = await loadProfileCountry(userId);
  if (profileCountry) {
    const geo = geoFromCountry(profileCountry);
    logRuntimeEvent("billing:currency_resolved", {
      country: geo.country,
      currency: geo.currency,
      source: "profile",
    });
    return { geo, source: "profile" };
  }

  const ipCountry = await fetchIpCountry();
  const picked = pickCabinetCountry("", ipCountry);
  if (picked.source === "ip") {
    const geo = geoFromCountry(picked.country);
    logRuntimeEvent("billing:currency_resolved", {
      country: geo.country,
      currency: geo.currency,
      source: "ip",
    });
    return { geo, source: "ip" };
  }

  logRuntimeEvent("billing:currency_unresolved", {}, "warn");
  return { geo: { currency: "EUR", country: "" }, source: "none" };
}

function followProfileGeoInBackground(userId: string | null): void {
  void resolveFromGeo(userId)
    .then((resolved) => {
      if (resolved.source === "profile") return persistProfileGeo(resolved.geo);
      return undefined;
    })
    .catch((error) => {
      logRuntimeEvent(
        "billing:currency_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
    });
}

export async function resolveBillingGeo(userId: string | null): Promise<BillingGeo> {
  if (cachedGeo && cachedGeo.country) {
    followProfileGeoInBackground(userId);
    return cachedGeo;
  }

  const storedSource = (await readAccountFlag(PERSIST_SOURCE_KEY))?.trim();
  const storedCurrency = await readAccountFlag(PERSIST_CURRENCY_KEY);
  const storedCountry = normalizeCountry(await readAccountFlag(PERSIST_COUNTRY_KEY));
  if (storedSource === "profile" && isBillingCurrency(storedCurrency) && storedCountry) {
    cachedGeo = { currency: storedCurrency, country: storedCountry };
    followProfileGeoInBackground(userId);
    return cachedGeo;
  }

  const geoPromise = resolveFromGeo(userId);
  try {
    const resolved = await Promise.race([
      geoPromise,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), GEO_TIMEOUT_MS);
      }),
    ]);
    if (resolved?.source === "profile") {
      await persistProfileGeo(resolved.geo);
      return resolved.geo;
    }
    if (resolved?.source === "ip") {
      // Ephemeral: VPN can change; do not persist to SecureStore or users.country_code.
      return resolved.geo;
    }
    if (resolved?.source === "none") {
      logRuntimeEvent("billing:currency_untrusted", { currency: resolved.geo.currency }, "warn");
      return resolved.geo;
    }
    logRuntimeEvent("billing:currency_geo_timeout", { ms: GEO_TIMEOUT_MS }, "warn");
    void geoPromise.then((late) => {
      if (late.source === "profile") return persistProfileGeo(late.geo);
      return undefined;
    });
    return { currency: "EUR", country: "" };
  } catch (error) {
    logRuntimeEvent(
      "billing:currency_error",
      { message: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    return { currency: "EUR", country: "" };
  }
}

export async function resolveBillingCurrency(userId: string | null): Promise<BillingCurrency> {
  const geo = await resolveBillingGeo(userId);
  return geo.currency;
}

/** Call after GPS grant so cabinet does not keep a stale IP-derived country. */
export function invalidateBillingGeoCache(): void {
  cachedGeo = null;
  void writeAccountFlag(PERSIST_CURRENCY_KEY, "");
  void writeAccountFlag(PERSIST_COUNTRY_KEY, "");
  void writeAccountFlag(PERSIST_SOURCE_KEY, "");
}

/** Test / sign-out helper. */
export function clearBillingGeoCacheForTests(): void {
  invalidateBillingGeoCache();
}
