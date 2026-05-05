import * as Location from "expo-location";

import { requireSupabase } from "@/services/supabase";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

export type UserLocationCoords = { lat: number; lng: number; timezone: string };

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Запрашивает foreground-доступ к геолокации (если нужно), читает текущую точку,
 * пишет lat/lon/tz в `public.users` и возвращает координаты для немедленного использования.
 */
export async function acquireAndPersistUserCoordinates(userId: string): Promise<UserLocationCoords | null> {
  try {
    logRuntimeEvent("location:auto_acquire_start", { userId }, "info");
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      logRuntimeEvent("location:auto_perm_request", { prior: perm.status }, "info");
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (perm.status !== "granted") {
      logRuntimeEvent("location:auto_perm_denied", { status: perm.status }, "warn");
      return null;
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const tz = deviceTimeZone();

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
      return null;
    }

    logRuntimeEvent("location:auto_acquire_ok", { accuracy: pos.coords.accuracy ?? null }, "info");
    return { lat, lng: lon, timezone: tz };
  } catch (error) {
    logRuntimeEvent(
      "location:auto_acquire_error",
      { message: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    return null;
  }
}
