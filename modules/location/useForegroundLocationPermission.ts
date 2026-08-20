/**
 * Live foreground-location permission.
 *
 * iOS terminates the app when Location goes Never → While Using. An
 * "awaiting grant" flag survives remount. «Ask Next Time» in Settings is not a
 * grant — on return we show the system sheet immediately so the user does not
 * have to tap the CTA a second time.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Location from "expo-location";

import {
  acquireAndPersistUserCoordinates,
  isAwaitingLocationSettingsGrant,
  isForegroundLocationGranted,
  markAwaitingLocationSettingsGrant,
  openAppLocationSettings,
  promptForegroundLocationAfterSettingsReturn,
  requestForegroundLocationPermission,
} from "@/modules/location/acquireAndPersistUserCoordinates";
import {
  notifyForegroundLocationPermissionChanged,
  subscribeForegroundLocationPermissionChanged,
} from "@/modules/location/foregroundLocationEvents";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

export type ForegroundLocationPermissionStatus = "checking" | "granted" | "denied";

const SETTINGS_POLL_MS = 700;
const SETTINGS_POLL_MAX_MS = 60_000;
const FOREGROUND_RECHECK_MS = [0, 500, 1500, 3500, 8000] as const;
const OPEN_SETTINGS_FLICKER_MS = 800;
/** iOS swallows the permission sheet if we present it mid-transition from Settings. */
const SETTINGS_RETURN_PROMPT_DELAY_MS = 550;
const PERM_READ_TIMEOUT_MS = 4_000;
const LAST_KNOWN_PROBE_MAX_AGE_MS = 5 * 60 * 1000;

async function readForegroundPermission(): Promise<Location.LocationPermissionResponse | null> {
  try {
    return await Promise.race([
      Location.getForegroundPermissionsAsync(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), PERM_READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  }
}

async function lastKnownImpliesGrant(): Promise<boolean> {
  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_PROBE_MAX_AGE_MS,
    });
    return Boolean(last?.coords);
  } catch {
    return false;
  }
}

export function useForegroundLocationPermission(options?: {
  onGranted?: () => void;
  userId?: string | null;
}) {
  const [status, setStatus] = useState<ForegroundLocationPermissionStatus>("checking");
  const prevStatusRef = useRef<ForegroundLocationPermissionStatus>("checking");
  const onGrantedRef = useRef(options?.onGranted);
  onGrantedRef.current = options?.onGranted;
  const userIdRef = useRef(options?.userId);
  userIdRef.current = options?.userId;
  const awaitingSettingsReturnRef = useRef(false);
  const openedSettingsAtRef = useRef(0);
  const applyingGrantRef = useRef(false);
  const settingsReturnPromptedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAtRef = useRef(0);
  const syncFromNativeRef = useRef<(source: string, opts?: { probeLastKnown?: boolean }) => Promise<unknown>>(
    async () => null,
  );

  const clearPollInterval = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const markAwaitingGrant = useCallback((value: boolean) => {
    awaitingSettingsReturnRef.current = value;
    void markAwaitingLocationSettingsGrant(value);
  }, []);

  const applyGrantedSideEffects = useCallback(async () => {
    if (applyingGrantRef.current) return;
    applyingGrantRef.current = true;
    clearPollInterval();
    markAwaitingGrant(false);
    try {
      const userId = userIdRef.current;
      if (userId) {
        await acquireAndPersistUserCoordinates(userId);
      }
      notifyForegroundLocationPermissionChanged();
      onGrantedRef.current?.();
    } finally {
      applyingGrantRef.current = false;
    }
  }, [clearPollInterval, markAwaitingGrant]);

  const syncFromNative = useCallback(
    async (source: string, opts?: { probeLastKnown?: boolean }) => {
      try {
        const perm = await readForegroundPermission();
        if (!perm) {
          if (prevStatusRef.current === "checking") {
            setStatus("denied");
            prevStatusRef.current = "denied";
          }
          logRuntimeEvent("location:windows_sync_timeout", { source }, "warn");
          return null;
        }
        let granted = isForegroundLocationGranted(perm);
        // last-known only: getCurrentPositionAsync can pop the OS dialog when undetermined.
        if (!granted && opts?.probeLastKnown && perm.status !== "undetermined") {
          granted = await lastKnownImpliesGrant();
          if (granted) {
            logRuntimeEvent("location:windows_last_known_granted", { source }, "info");
          }
        }
        const next: ForegroundLocationPermissionStatus = granted ? "granted" : "denied";
        const prev = prevStatusRef.current;
        logRuntimeEvent("location:windows_sync", {
          source,
          status: perm.status,
          granted: perm.granted,
          canAskAgain: perm.canAskAgain,
          prev,
          next,
        });
        setStatus(next);

        if (next === "granted" && prev !== "granted") {
          prevStatusRef.current = next;
          await applyGrantedSideEffects();
        } else {
          prevStatusRef.current = next;
        }
        return perm;
      } catch {
        setStatus("denied");
        prevStatusRef.current = "denied";
        return null;
      }
    },
    [applyGrantedSideEffects],
  );
  syncFromNativeRef.current = syncFromNative;

  const applyFromPerm = useCallback(
    async (perm: Location.LocationPermissionResponse) => {
      const next: ForegroundLocationPermissionStatus = isForegroundLocationGranted(perm)
        ? "granted"
        : "denied";
      const prev = prevStatusRef.current;
      setStatus(next);
      prevStatusRef.current = next;
      if (next === "granted" && prev !== "granted") {
        await applyGrantedSideEffects();
      }
    },
    [applyGrantedSideEffects],
  );

  const promptAfterSettingsReturn = useCallback(
    async (source: string) => {
      if (prevStatusRef.current === "granted") return;
      if (settingsReturnPromptedRef.current) return;
      settingsReturnPromptedRef.current = true;
      logRuntimeEvent("location:windows_settings_return", { source });
      const perm = await promptForegroundLocationAfterSettingsReturn(source);
      awaitingSettingsReturnRef.current = false;
      await applyFromPerm(perm);
    },
    [applyFromPerm],
  );

  const startPermissionPoll = useCallback((persistAwaiting: boolean) => {
    clearPollInterval();
    if (persistAwaiting) markAwaitingGrant(true);
    pollStartedAtRef.current = Date.now();
    pollTimerRef.current = setInterval(() => {
      if (prevStatusRef.current === "granted") {
        clearPollInterval();
        return;
      }
      const elapsed = Date.now() - pollStartedAtRef.current;
      if (elapsed > SETTINGS_POLL_MAX_MS) {
        clearPollInterval();
        return;
      }
      void syncFromNativeRef.current("settings-poll", { probeLastKnown: elapsed > 1_500 });
    }, SETTINGS_POLL_MS);
  }, [clearPollInterval, markAwaitingGrant]);

  const recheckUntilGranted = useCallback((source: string) => {
    if (prevStatusRef.current === "granted") return;
    for (const delay of FOREGROUND_RECHECK_MS) {
      setTimeout(() => {
        if (prevStatusRef.current === "granted") return;
        void syncFromNativeRef.current(source, { probeLastKnown: delay >= 1500 });
      }, delay);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await syncFromNativeRef.current("mount");
      if (cancelled || prevStatusRef.current === "granted") return;
      const persistedAwait = await isAwaitingLocationSettingsGrant();
      if (cancelled || prevStatusRef.current === "granted") return;
      if (persistedAwait) {
        awaitingSettingsReturnRef.current = true;
        await new Promise((resolve) => setTimeout(resolve, SETTINGS_RETURN_PROMPT_DELAY_MS));
        if (cancelled || prevStatusRef.current === "granted") return;
        await promptAfterSettingsReturn("mount");
        return;
      }
      startPermissionPoll(false);
    })();

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") return;
      if (prevStatusRef.current === "granted") return;
      const sinceOpen = Date.now() - openedSettingsAtRef.current;
      if (awaitingSettingsReturnRef.current && sinceOpen < OPEN_SETTINGS_FLICKER_MS) {
        return;
      }
      if (awaitingSettingsReturnRef.current) {
        setTimeout(() => {
          if (prevStatusRef.current === "granted") return;
          void promptAfterSettingsReturn("appstate");
        }, SETTINGS_RETURN_PROMPT_DELAY_MS);
        return;
      }
      recheckUntilGranted("appstate");
    });
    const unsub = subscribeForegroundLocationPermissionChanged(() => {
      void syncFromNativeRef.current("notify");
    });
    return () => {
      cancelled = true;
      sub.remove();
      unsub();
      clearPollInterval();
    };
  }, [clearPollInterval, promptAfterSettingsReturn, recheckUntilGranted, startPermissionPoll]);

  const recheck = useCallback(() => {
    if (prevStatusRef.current === "granted") return;
    recheckUntilGranted("focus");
  }, [recheckUntilGranted]);

  const request = useCallback(async () => {
    try {
      const current = await Location.getForegroundPermissionsAsync();
      if (isForegroundLocationGranted(current)) {
        setStatus("granted");
        if (prevStatusRef.current !== "granted") {
          prevStatusRef.current = "granted";
          await applyGrantedSideEffects();
        }
        return;
      }
      const permanentlyDenied = current.status !== "undetermined" && current.canAskAgain === false;
      if (permanentlyDenied) {
        logRuntimeEvent("location:windows_open_settings", { status: current.status });
        openedSettingsAtRef.current = Date.now();
        awaitingSettingsReturnRef.current = true;
        settingsReturnPromptedRef.current = false;
        await markAwaitingLocationSettingsGrant(true);
        startPermissionPoll(true);
        await openAppLocationSettings();
        return;
      }
      logRuntimeEvent("location:windows_request", {
        status: current.status,
        canAskAgain: current.canAskAgain,
      });
      const perm = await requestForegroundLocationPermission();
      logRuntimeEvent("location:windows_result", { status: perm.status, canAskAgain: perm.canAskAgain });
      await applyFromPerm(perm);
    } catch (error) {
      logRuntimeEvent(
        "location:windows_request_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      setStatus("denied");
      prevStatusRef.current = "denied";
    }
  }, [applyFromPerm, applyGrantedSideEffects, startPermissionPoll]);

  return { status, request, recheck };
}
