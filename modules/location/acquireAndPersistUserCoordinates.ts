import * as Location from "expo-location";
import { InteractionManager } from "react-native";

import { invalidateBillingGeoCache } from "@/modules/account/core/billingCurrency";
import { notifyForegroundLocationPermissionChanged } from "@/modules/location/foregroundLocationEvents";
import { scheduleGeoPlaceSyncAfterCoords } from "@/modules/location/syncUserGeoPlace";
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
/** After OTP / splash, iOS swallows the permission alert if we present it mid-navigation. */
const LAUNCH_PROMPT_SETTLE_MS = 700;

let permissionRequestInFlight: Promise<Location.LocationPermissionResponse> | null = null;
/** Auto (launch/Home) already called the OS prompt this process — don't spam it. */
let autoPromptedThisProcess = false;
let acquireInFlight: Promise<LocationAcquireResult> | null = null;

function waitForUiSettle(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(resolve, LAUNCH_PROMPT_SETTLE_MS);
    });
  });
}

/** Sign-out / new session: allow the launch prompt again in this JS process. */
export function resetLocationPermissionAutoPrompt(): void {
  autoPromptedThisProcess = false;
}

export type LocationPermissionRequestOptions = {
  /** CTA / onboarding Next — may ask again even after the launch auto-prompt. */
  userInitiated?: boolean;
};

/**
 * Foreground location permission. Auto callers ask at most once per process;
 * a user tap can still invoke the OS prompt (if the OS still allows it).
 *
 * After iOS «Don't Allow» / Android «Don't ask again», the OS will not show
 * the system dialog again — `request` returns denied immediately.
 */
export async function getOrRequestForegroundLocationPermission(
  options?: LocationPermissionRequestOptions,
): Promise<Location.LocationPermissionResponse> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === "granted") return current;
  if (permissionRequestInFlight) return permissionRequestInFlight;
  // Auto callers: at most once per JS process. User CTA always reaches the OS API below.
  if (!options?.userInitiated && autoPromptedThisProcess) {
    return current;
  }

  autoPromptedThisProcess = true;
  logRuntimeEvent("location:auto_perm_request", {
    prior: current.status,
    canAskAgain: current.canAskAgain,
    userInitiated: Boolean(options?.userInitiated),
  });
  permissionRequestInFlight = Location.requestForegroundPermissionsAsync().finally(() => {
    permissionRequestInFlight = null;
  });
  return permissionRequestInFlight;
}

/**
 * Cold-start: if location is not granted, ask the OS (once per process).
 * Does not persist IP into `users.country_code`.
 */
export async function promptForegroundLocationOnLaunch(userId: string): Promise<void> {
  try {
    await waitForUiSettle();
    const before = await Location.getForegroundPermissionsAsync();
    if (before.status === "granted") {
      notifyForegroundLocationPermissionChanged();
      return;
    }
    const perm = await getOrRequestForegroundLocationPermission();
    notifyForegroundLocationPermissionChanged();
    logRuntimeEvent("location:launch_prompt_result", {
      prior: before.status,
      status: perm.status,
      canAskAgain: perm.canAskAgain,
    });
    if (perm.status === "granted" && before.status !== "granted") {
      void acquireAndPersistUserCoordinates(userId);
    }
  } catch (error) {
    logRuntimeEvent(
      "location:launch_prompt_error",
      { message: error instanceof Error ? error.message : String(error) },
      "warn",
    );
  }
}

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

/** Быстро пишет lat/lon/tz; страну/город — фоном (не тормозит Home). */
async function persistCoords(
  userId: string,
  lat: number,
  lon: number,
  tz: string,
): Promise<LocationAcquireResult> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from("users")
    .update({ lat, lon, tz })
    .eq("id", userId);

  if (error) {
    logRuntimeEvent("location:auto_persist_error", { message: error.message }, "warn");
    return { ok: false, reason: "persist_failed" };
  }

  scheduleGeoPlaceSyncAfterCoords(userId);
  return { ok: true, coords: { lat, lng: lon, timezone: tz }, persisted: true };
}

async function acquireAndPersistUserCoordinatesImpl(userId: string): Promise<LocationAcquireResult> {
  logRuntimeEvent("location:auto_acquire_start", { userId }, "info");
  const perm = await getOrRequestForegroundLocationPermission();
  if (perm.status !== "granted") {
    logRuntimeEvent("location:auto_perm_denied", { status: perm.status }, "warn");
    notifyForegroundLocationPermissionChanged();
    return { ok: false, reason: "permission_denied" };
  }
  notifyForegroundLocationPermissionChanged();

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
    invalidateBillingGeoCache();
    return result;
  }

  logRuntimeEvent(
    "location:auto_acquire_coords_only",
    { reason: result.reason, accuracy: pos.coords.accuracy ?? null },
    "warn",
  );
  return { ok: true, coords, persisted: false };
}

/**
 * Запрашивает foreground-доступ к геолокации (если нужно), читает текущую или
 * последнюю известную точку (с таймаутом), пишет lat/lon/tz в `public.users`.
 * `country_code` не трогает: страну пишет только Nominatim после GPS.
 */
export async function acquireAndPersistUserCoordinates(userId: string): Promise<LocationAcquireResult> {
  if (acquireInFlight) return acquireInFlight;
  acquireInFlight = (async () => {
    try {
      return await acquireAndPersistUserCoordinatesImpl(userId);
    } catch (error) {
      logRuntimeEvent(
        "location:auto_acquire_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      return { ok: false, reason: "unavailable" as const };
    }
  })().finally(() => {
    acquireInFlight = null;
  });
  return acquireInFlight;
}
