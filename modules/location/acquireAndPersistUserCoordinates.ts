import * as Location from "expo-location";
import { InteractionManager, Linking, Platform } from "react-native";

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
/** Survives iOS process kill when Location goes Never → While Using. */
const AWAIT_SETTINGS_GRANT_KEY = "harmonizer.location.awaitingSettingsGrant";

type SecureStoreLike = typeof import("expo-secure-store");

function getSecureStore(): SecureStoreLike | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-secure-store") as SecureStoreLike;
  } catch {
    return null;
  }
}

export async function markAwaitingLocationSettingsGrant(value: boolean): Promise<void> {
  const store = getSecureStore();
  if (!store) return;
  try {
    if (value) await store.setItemAsync(AWAIT_SETTINGS_GRANT_KEY, "1");
    else await store.deleteItemAsync(AWAIT_SETTINGS_GRANT_KEY);
  } catch {
    /* ignore */
  }
}

export async function isAwaitingLocationSettingsGrant(): Promise<boolean> {
  const store = getSecureStore();
  if (!store) return false;
  try {
    return (await store.getItemAsync(AWAIT_SETTINGS_GRANT_KEY)) === "1";
  } catch {
    return false;
  }
}

let permissionRequestInFlight: Promise<Location.LocationPermissionResponse> | null = null;
/** After Settings: one system-sheet attempt shared by launch + Opportunity Windows. */
let settingsReturnPromptInFlight: Promise<Location.LocationPermissionResponse> | null = null;
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

function osLocationDialogUnavailable(perm: Location.LocationPermissionResponse): boolean {
  // On Android, `canAskAgain` (derived from `shouldShowRequestPermissionRationale`)
  // is unreliable after the user changes the system permission setting (e.g.
  // "Don't ask again" → "Ask every time"): it stays `false` from the last
  // request until the app calls `requestPermissions()` again. Pre-judging as
  // unavailable here skips the launch auto-prompt and loops back to Settings.
  // Let the OS decide — `requestPermissions()` shows the dialog when it can,
  // or returns denied silently when the user truly selected "Don't ask again".
  if (Platform.OS === "android") {
    return false;
  }
  return perm.status !== "granted" && perm.status !== "undetermined" && perm.canAskAgain === false;
}

function osCanShowLocationDialog(perm: Location.LocationPermissionResponse): boolean {
  return !osLocationDialogUnavailable(perm);
}

export function osCanShowForegroundLocationDialog(perm: Location.LocationPermissionResponse): boolean {
  return osCanShowLocationDialog(perm);
}

export function isForegroundLocationGranted(perm: Location.LocationPermissionResponse): boolean {
  return perm.status === "granted" || perm.granted === true;
}

/**
 * App settings page (`Linking.openSettings` / `UIApplication.openSettingsURLString`).
 * iOS has no public URL for the nested Location radio page (Never / Ask Next Time /
 * While Using) — Location is the first row on this screen.
 */
export async function openAppLocationSettings(): Promise<void> {
  logRuntimeEvent("location:open_settings", {});
  await Linking.openSettings();
}

/**
 * System location dialog. Does not open Settings — callers open settings themselves
 * when the OS already cannot show a dialog (iOS «Never»).
 */
export async function requestForegroundLocationPermission(): Promise<Location.LocationPermissionResponse> {
  const current = await Location.getForegroundPermissionsAsync();
  if (isForegroundLocationGranted(current)) return current;
  if (permissionRequestInFlight) return permissionRequestInFlight;
  logRuntimeEvent("location:perm_request", {
    prior: current.status,
    canAskAgain: current.canAskAgain,
  });
  permissionRequestInFlight = Location.requestForegroundPermissionsAsync().finally(() => {
    permissionRequestInFlight = null;
  });
  return permissionRequestInFlight;
}

/**
 * After Settings we opened: «Ask Next Time» is not a grant — only the system
 * sheet can grant. Show that sheet immediately so the user does not tap CTA twice.
 * iOS may still report Never for a moment after the radio change — retry briefly.
 * «While Using» is already granted. Still «Never» after retries → no-op.
 */
export async function promptForegroundLocationAfterSettingsReturn(
  source: string,
): Promise<Location.LocationPermissionResponse> {
  if (settingsReturnPromptInFlight) return settingsReturnPromptInFlight;
  settingsReturnPromptInFlight = (async () => {
    const retryDelayMs = 350;
    const retryCount = 8;
    let last = await Location.getForegroundPermissionsAsync();
    for (let i = 0; i < retryCount; i += 1) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        last = await Location.getForegroundPermissionsAsync();
      }
      if (isForegroundLocationGranted(last)) {
        await markAwaitingLocationSettingsGrant(false);
        notifyForegroundLocationPermissionChanged();
        return last;
      }
      if (osCanShowLocationDialog(last)) {
        logRuntimeEvent("location:settings_return_prompt", {
          source,
          attempt: i,
          status: last.status,
          canAskAgain: last.canAskAgain,
        });
        const perm = await requestForegroundLocationPermission();
        await markAwaitingLocationSettingsGrant(false);
        notifyForegroundLocationPermissionChanged();
        logRuntimeEvent("location:settings_return_result", {
          source,
          status: perm.status,
          canAskAgain: perm.canAskAgain,
        });
        return perm;
      }
    }
    logRuntimeEvent("location:settings_return_still_never", {
      source,
      status: last.status,
      canAskAgain: last.canAskAgain,
    });
    return last;
  })().finally(() => {
    settingsReturnPromptInFlight = null;
  });
  return settingsReturnPromptInFlight;
}

/**
 * After login / Home load:
 * - granted → acquire GPS
 * - Ask Next Time / Allow Once / never-asked → system dialog (once per JS process)
 * - Never → do nothing; Opportunity Windows CTA opens settings
 * - returning from Settings with Ask Next Time → system dialog immediately
 */
export async function promptForegroundLocationOnLaunch(userId: string): Promise<void> {
  try {
    await waitForUiSettle();
    const before = await Location.getForegroundPermissionsAsync();
    if (isForegroundLocationGranted(before)) {
      await markAwaitingLocationSettingsGrant(false);
      notifyForegroundLocationPermissionChanged();
      void acquireAndPersistUserCoordinates(userId);
      return;
    }
    if (await isAwaitingLocationSettingsGrant()) {
      const perm = await promptForegroundLocationAfterSettingsReturn("launch");
      if (isForegroundLocationGranted(perm)) {
        void acquireAndPersistUserCoordinates(userId);
      }
      return;
    }
    if (!osCanShowLocationDialog(before)) {
      notifyForegroundLocationPermissionChanged();
      logRuntimeEvent("location:launch_prompt_skip_never", {
        status: before.status,
        canAskAgain: before.canAskAgain,
      });
      return;
    }
    if (autoPromptedThisProcess) {
      notifyForegroundLocationPermissionChanged();
      return;
    }
    autoPromptedThisProcess = true;
    const perm = await requestForegroundLocationPermission();
    notifyForegroundLocationPermissionChanged();
    logRuntimeEvent("location:launch_prompt_result", {
      prior: before.status,
      status: perm.status,
      canAskAgain: perm.canAskAgain,
    });
    if (isForegroundLocationGranted(perm)) {
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
  const perm = await Location.getForegroundPermissionsAsync();
  if (!isForegroundLocationGranted(perm)) {
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
 * Читает GPS и пишет lat/lon/tz в `public.users`, только если foreground-доступ
 * уже выдан. Системный диалог не вызывает — его показывают launch / onboarding / CTA.
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
