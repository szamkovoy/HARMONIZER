/**
 * Валюта цен Личного кабинета по геолокации пользователя.
 *
 * Правило продукта (2026-07-15): Россия -> RUB, США -> USD, весь остальной
 * мир -> EUR. Страна определяется обратным геокодированием координат,
 * которые приложение уже получило для «Окон возможностей» (без гео
 * приложение не работает). Fallback при недоступном геокодере — EUR.
 */
import * as Location from "expo-location";

import { loadCachedUserCoords } from "@/modules/location/userLocationProfileCache";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

export type BillingCurrency = "RUB" | "USD" | "EUR";

function currencyForCountry(isoCountryCode: string | null | undefined): BillingCurrency {
  const code = isoCountryCode?.trim().toUpperCase();
  if (code === "RU") return "RUB";
  if (code === "US") return "USD";
  return "EUR";
}

/** Кэш на сессию: страна пользователя не меняется между открытиями кабинета. */
let cachedCurrency: BillingCurrency | null = null;

export async function resolveBillingCurrency(userId: string | null): Promise<BillingCurrency> {
  if (cachedCurrency) return cachedCurrency;
  try {
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
    cachedCurrency = currency;
    logRuntimeEvent("billing:currency_resolved", { country: places[0]?.isoCountryCode ?? null, currency });
    return currency;
  } catch (error) {
    logRuntimeEvent(
      "billing:currency_error",
      { message: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    return "EUR";
  }
}
