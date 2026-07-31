/**
 * Валюта и страна биллинга Личного кабинета по геолокации.
 *
 * Правило продукта: Россия -> RUB + country RU; США -> USD; иначе EUR.
 * Страна (ISO) уходит в кабинет для выбора платёжного шлюза (RU/INT).
 */
import * as Location from "expo-location";

import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import { loadCachedUserCoords } from "@/modules/location/userLocationProfileCache";
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

/** Кэш на сессию. */
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

async function persistGeo(geo: BillingGeo): Promise<void> {
  cachedGeo = geo;
  await writeAccountFlag(PERSIST_CURRENCY_KEY, geo.currency);
  await writeAccountFlag(PERSIST_COUNTRY_KEY, geo.country);
}

async function resolveFromGeo(userId: string | null): Promise<BillingGeo> {
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
  const country = (places[0]?.isoCountryCode ?? "").trim().toUpperCase();
  const currency = currencyForCountry(country || null);
  logRuntimeEvent("billing:currency_resolved", { country: country || null, currency });
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
  if (cachedGeo) return cachedGeo;

  const storedCurrency = await readAccountFlag(PERSIST_CURRENCY_KEY);
  const storedCountry = (await readAccountFlag(PERSIST_COUNTRY_KEY))?.trim().toUpperCase() ?? "";
  if (isBillingCurrency(storedCurrency)) {
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
    if (geo) {
      await persistGeo(geo);
      return geo;
    }
    logRuntimeEvent("billing:currency_geo_timeout", { ms: GEO_TIMEOUT_MS }, "warn");
    followGeoInBackground(geoPromise);
    const fallback: BillingGeo = { currency: "EUR", country: "" };
    await persistGeo(fallback);
    return fallback;
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
