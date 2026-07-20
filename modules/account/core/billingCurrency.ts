/**
 * Валюта цен Личного кабинета по геолокации пользователя.
 *
 * Правило продукта (2026-07-15): Россия -> RUB, США -> USD, весь остальной
 * мир -> EUR. Страна определяется обратным геокодированием координат,
 * которые приложение уже получило для «Окон возможностей» (без гео
 * приложение не работает). Fallback при недоступном геокодере — EUR.
 *
 * Открытие кабинета не ждёт долгий reverse-geocode: есть in-memory кэш,
 * персистентный флаг и жёсткий таймаут (иначе Safari открывается с большой
 * белой паузой до openURL).
 */
import * as Location from "expo-location";

import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import { loadCachedUserCoords } from "@/modules/location/userLocationProfileCache";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

export type BillingCurrency = "RUB" | "USD" | "EUR";

const GEO_TIMEOUT_MS = 800;
const PERSIST_KEY = "billingCurrency";

/** Кэш на сессию: страна пользователя не меняется между открытиями кабинета. */
let cachedCurrency: BillingCurrency | null = null;

function isBillingCurrency(value: string | null | undefined): value is BillingCurrency {
  return value === "RUB" || value === "USD" || value === "EUR";
}

function currencyForCountry(isoCountryCode: string | null | undefined): BillingCurrency {
  const code = isoCountryCode?.trim().toUpperCase();
  if (code === "RU") return "RUB";
  if (code === "US") return "USD";
  return "EUR";
}

async function persistCurrency(currency: BillingCurrency): Promise<void> {
  cachedCurrency = currency;
  await writeAccountFlag(PERSIST_KEY, currency);
}

async function resolveFromGeo(userId: string | null): Promise<BillingCurrency> {
  let coords = userId ? await loadCachedUserCoords(userId) : null;
  if (!coords) {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 24 * 60 * 60 * 1000 });
    if (last) coords = { lat: last.coords.latitude, lng: last.coords.longitude, timezone: "" };
  }
  if (!coords) {
    logRuntimeEvent("billing:currency_no_coords", {}, "warn");
    return "EUR";
  }
  const places = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng });
  const currency = currencyForCountry(places[0]?.isoCountryCode);
  logRuntimeEvent("billing:currency_resolved", {
    country: places[0]?.isoCountryCode ?? null,
    currency,
  });
  return currency;
}

/** Фоновое уточнение валюты после быстрого ответа (не блокирует openURL). */
function followGeoInBackground(geoPromise: Promise<BillingCurrency>): void {
  void geoPromise
    .then((currency) => persistCurrency(currency))
    .catch((error) => {
      logRuntimeEvent(
        "billing:currency_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
    });
}

export async function resolveBillingCurrency(userId: string | null): Promise<BillingCurrency> {
  if (cachedCurrency) return cachedCurrency;

  const stored = await readAccountFlag(PERSIST_KEY);
  if (isBillingCurrency(stored)) {
    cachedCurrency = stored;
    followGeoInBackground(resolveFromGeo(userId));
    return stored;
  }

  const geoPromise = resolveFromGeo(userId);
  try {
    const currency = await Promise.race([
      geoPromise,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), GEO_TIMEOUT_MS);
      }),
    ]);
    if (currency) {
      await persistCurrency(currency);
      return currency;
    }
    logRuntimeEvent("billing:currency_geo_timeout", { ms: GEO_TIMEOUT_MS }, "warn");
    followGeoInBackground(geoPromise);
    await persistCurrency("EUR");
    return "EUR";
  } catch (error) {
    logRuntimeEvent(
      "billing:currency_error",
      { message: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    return "EUR";
  }
}
