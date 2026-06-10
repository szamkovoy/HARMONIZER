import * as Location from "expo-location";

import { saveCachedUserCoords } from "@/modules/location/userLocationProfileCache";
import { requireSupabase } from "@/services/supabase";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

export type UserLocationCoords = { lat: number; lng: number; timezone: string };

export type LocationAcquireFailureReason = "permission_denied" | "timeout" | "unavailable" | "persist_failed";

export type LocationAcquireResult =
  | { ok: true; coords: UserLocationCoords; persisted: boolean }
  | { ok: false; reason: LocationAcquireFailureReason };

/** Не держим home на сплэше дольше этого при cold GPS. */
export const LOCATION_ACQUIRE_TIMEOUT_MS = 12_000;
const LAST_KNOWN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function readPosition(): Promise<Location.LocationObject | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) {
      logRuntimeEvent("location:last_known_hit", { accuracy: last.coords.accuracy ?? null }, "info");
      return last;
    }
  } catch {
    /* last known необязателен */
  }

  try {
    const current = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), LOCATION_ACQUIRE_TIMEOUT_MS);
      }),
    ]);
    if (!current) {
      logRuntimeEvent("location:current_position_timeout", { timeoutMs: LOCATION_ACQUIRE_TIMEOUT_MS }, "warn");
      return null;
    }
    return current;
  } catch {
    return null;
  }
}

async function persistCoords(
  userId: string,
  lat: number,
  lon: number,
  tz: string,
): Promise<LocationAcquireResult> {
  let locationName: string | null = null;
  try {
    const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    const first = places[0];
    if (first) {
      locationName = [first.city, first.region, first.country].filter(Boolean).join(", ");
    }
  } catch {
    /* необязательно */
  }

  const supabase = requireSupabase();
  const { error } = await supabase
    .from("users")
    .update({
      lat,
      lon,
      tz,
      ...(locationName ? { location_name: locationName } : {}),
    })
    .eq("id", userId);

  if (error) {
    logRuntimeEvent("location:auto_persist_error", { message: error.message }, "warn");
    return { ok: false, reason: "persist_failed" };
  }

  return { ok: true, coords: { lat, lng: lon, timezone: tz }, persisted: true };
}

/**
 * Запрашивает foreground-доступ к геолокации (если нужно), читает текущую или
 * последнюю известную точку (с таймаутом), пишет lat/lon/tz в `public.users`.
 */
export async function acquireAndPersistUserCoordinates(userId: string): Promise<LocationAcquireResult> {
  try {
    logRuntimeEvent("location:auto_acquire_start", { userId }, "info");
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      logRuntimeEvent("location:auto_perm_request", { prior: perm.status }, "info");
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (perm.status !== "granted") {
      logRuntimeEvent("location:auto_perm_denied", { status: perm.status }, "warn");
      return { ok: false, reason: "permission_denied" };
    }

    const pos = await readPosition();
    if (!pos) {
      return { ok: false, reason: "timeout" };
    }

    const coords: UserLocationCoords = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      timezone: deviceTimeZone(),
    };
    await saveCachedUserCoords(userId, coords);

    const result = await persistCoords(userId, coords.lat, coords.lng, coords.timezone);
    if (result.ok) {
      logRuntimeEvent("location:auto_acquire_ok", { accuracy: pos.coords.accuracy ?? null }, "info");
      return result;
    }

    logRuntimeEvent(
      "location:auto_acquire_coords_only",
      { reason: result.reason, accuracy: pos.coords.accuracy ?? null },
      "warn",
    );
    return { ok: true, coords, persisted: false };
  } catch (error) {
    logRuntimeEvent(
      "location:auto_acquire_error",
      { message: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    return { ok: false, reason: "unavailable" };
  }
}
