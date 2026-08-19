/**
 * Live foreground-location permission. Observes AppState and an in-process
 * notify so a grant from the launch-time GPS acquire is picked up without
 * waiting for a settings round-trip.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import * as Location from "expo-location";

import { getOrRequestForegroundLocationPermission } from "@/modules/location/acquireAndPersistUserCoordinates";
import { subscribeForegroundLocationPermissionChanged } from "@/modules/location/foregroundLocationEvents";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

export type ForegroundLocationPermissionStatus = "checking" | "granted" | "denied";

export function useForegroundLocationPermission(options?: { onGranted?: () => void }) {
  const [status, setStatus] = useState<ForegroundLocationPermissionStatus>("checking");
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [busy, setBusy] = useState(false);
  const prevStatusRef = useRef<ForegroundLocationPermissionStatus>("checking");
  const onGrantedRef = useRef(options?.onGranted);
  onGrantedRef.current = options?.onGranted;

  const check = useCallback(async () => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      setCanAskAgain(perm.canAskAgain !== false);
      setStatus(perm.status === "granted" ? "granted" : "denied");
    } catch {
      setStatus("denied");
    }
  }, []);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    const unsub = subscribeForegroundLocationPermissionChanged(() => {
      void check();
    });
    return () => {
      sub.remove();
      unsub();
    };
  }, [check]);

  useEffect(() => {
    if (prevStatusRef.current === "denied" && status === "granted") {
      onGrantedRef.current?.();
    }
    prevStatusRef.current = status;
  }, [status]);

  const request = useCallback(async () => {
    setBusy(true);
    try {
      const current = await Location.getForegroundPermissionsAsync();
      if (current.status === "granted") {
        setStatus("granted");
        return;
      }
      if (current.canAskAgain === false) {
        logRuntimeEvent("location:windows_open_settings", {});
        await Linking.openSettings();
        return;
      }
      logRuntimeEvent("location:windows_request", {});
      const perm = await getOrRequestForegroundLocationPermission({ userInitiated: true });
      logRuntimeEvent("location:windows_result", { status: perm.status, canAskAgain: perm.canAskAgain });
      setCanAskAgain(perm.canAskAgain !== false);
      setStatus(perm.status === "granted" ? "granted" : "denied");
    } catch (error) {
      logRuntimeEvent(
        "location:windows_request_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      setStatus("denied");
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, canAskAgain, busy, request };
}
