/**
 * Валюта и страна биллинга Личного кабинета по геолокации.
 *
 * Правило продукта: Россия -> RUB + country RU; США -> USD; иначе EUR.
 * Страна (ISO) уходит в кабинет для выбора платёжного шлюза (RU/INT).
 *
 * Приоритет источника страны:
 *   1) `users.country_code` (уже синхронизирован GeoGate / app_open через Nominatim)
 *   2) reverse-geocode кэшированных GPS-координат
 *
 * Timeout 800 мс не должен «залипать» как EUR в персисте — иначе кабинет
 * навсегда открывается с Lava/EUR, даже когда в профиле уже RU.
 */
import * as Location from "expo-location";

import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import { loadCachedUserCoords } from "@/modules/location/userLocationProfileCache";
import { getSupabase } from "@/services/supabase";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

export type BillingCurrency = "RUB" | "USD" | "EUR";

export type BillingGeo = {
  currency: BillingCurrency;
  /** ISO-3166 alpha-2; empty if unknown. */
  country: string;
};

const GEO_TIMEOUT_MS = 800;
const PERSIST_CURRENCY_KEY = "billingCurrency";
const PERSIST_COUNTRY_KEY = "billingCountry";

/** Кэш на сессию — только trusted geo (есть country или явный RUB/USD). */
let cachedGeo: BillingGeo | null = null;

function isBillingCurrency(value: string | null | undefined): value is BillingCurrency {
  return value === "RUB" || value === "USD" || value === "EUR";
}

function currencyForCountry(isoCountryCode: string | null | undefined): BillingCurrency {
  const code = isoCountryCode?.trim().toUpperCase();
  if (code === "RU") return "RUB";
  if (code === "US") return "USD";
  return "EUR";
}

function normalizeCountry(raw: string | null | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

/** EUR без страны — ненадёжный fallback (timeout / нет coords); не кэшируем как истину. */
function isTrustedGeo(geo: BillingGeo): boolean {
  if (geo.country) return true;
  return geo.currency === "RUB" || geo.currency === "USD";
}

async function persistGeo(geo: BillingGeo): Promise<void> {
  if (!isTrustedGeo(geo)) return;
  cachedGeo = geo;
  await writeAccountFlag(PERSIST_CURRENCY_KEY, geo.currency);
  await writeAccountFlag(PERSIST_COUNTRY_KEY, geo.country);
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

async function resolveFromGeo(userId: string | null): Promise<BillingGeo> {
  const profileCountry = await loadProfileCountry(userId);
  if (profileCountry) {
    const currency = currencyForCountry(profileCountry);
    logRuntimeEvent("billing:currency_resolved", {
      country: profileCountry,
      currency,
      source: "profile",
    });
    return { currency, country: profileCountry };
  }

  let coords = userId ? await loadCachedUserCoords(userId) : null;
  if (!coords) {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 24 * 60 * 60 * 1000 });
    if (last) coords = { lat: last.coords.latitude, lng: last.coords.longitude, timezone: "" };
  }
  if (!coords) {
    logRuntimeEvent("billing:currency_no_coords", {}, "warn");
    return { currency: "EUR", country: "" };
  }
  const places = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng });
  const country = normalizeCountry(places[0]?.isoCountryCode);
  const currency = currencyForCountry(country || null);
  logRuntimeEvent("billing:currency_resolved", {
    country: country || null,
    currency,
    source: "reverse_geocode",
  });
  return { currency, country };
}

function followGeoInBackground(geoPromise: Promise<BillingGeo>): void {
  void geoPromise
    .then((geo) => persistGeo(geo))
    .catch((error) => {
      logRuntimeEvent(
        "billing:currency_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
    });
}

export async function resolveBillingGeo(userId: string | null): Promise<BillingGeo> {
  if (cachedGeo && isTrustedGeo(cachedGeo)) return cachedGeo;

  const storedCurrency = await readAccountFlag(PERSIST_CURRENCY_KEY);
  const storedCountry = normalizeCountry(await readAccountFlag(PERSIST_COUNTRY_KEY));
  if (isBillingCurrency(storedCurrency) && (storedCountry || storedCurrency === "RUB")) {
    cachedGeo = {
      currency: storedCurrency,
      country: storedCountry || (storedCurrency === "RUB" ? "RU" : ""),
    };
    followGeoInBackground(resolveFromGeo(userId));
    return cachedGeo;
  }

  const geoPromise = resolveFromGeo(userId);
  try {
    const geo = await Promise.race([
      geoPromise,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), GEO_TIMEOUT_MS);
      }),
    ]);
    if (geo && isTrustedGeo(geo)) {
      await persistGeo(geo);
      return geo;
    }
    if (geo && !isTrustedGeo(geo)) {
      // Реальный ответ «страна неизвестна» — не залипаем в персисте.
      logRuntimeEvent("billing:currency_untrusted", { currency: geo.currency }, "warn");
      followGeoInBackground(geoPromise);
      return geo;
    }
    logRuntimeEvent("billing:currency_geo_timeout", { ms: GEO_TIMEOUT_MS }, "warn");
    followGeoInBackground(geoPromise);
    // Эфемерный EUR: не пишем в SecureStore, чтобы следующий тап мог взять profile RU.
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

/** Test / sign-out helper. */
export function clearBillingGeoCacheForTests(): void {
  cachedGeo = null;
}
