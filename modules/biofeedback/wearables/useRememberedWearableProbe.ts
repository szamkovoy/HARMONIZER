import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { getWearableBleManager } from "@/modules/biofeedback/wearables/bleManager";
import { HEART_RATE_SERVICE_UUID } from "@/modules/biofeedback/wearables/heartRateMeasurement";
import { describeWearableCandidate } from "@/modules/biofeedback/wearables/trustedProfiles";
import type { WearableScanCandidate } from "@/modules/biofeedback/wearables/types";

export type RememberedWearableProbeState = {
  probing: boolean;
  /** `null` until the first probe for this device id finishes. */
  available: boolean | null;
  candidate: WearableScanCandidate | null;
  refresh: () => void;
};

/**
 * Instant check whether a remembered chest strap is known to the OS BLE stack
 * or currently advertising. We intentionally do a short live scan instead of
 * trusting `manager.devices()`: iOS may keep returning a remembered peripheral
 * long after it stopped being available for a real session.
 */
const REMEMBERED_PROBE_TIMEOUT_MS = 4_000;
const REMEMBERED_PROBE_SCAN_OPTIONS = { allowDuplicates: true } as const;

export function useRememberedWearableProbe(
  deviceId: string | null | undefined,
  enabled: boolean,
): RememberedWearableProbeState {
  const [probing, setProbing] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [candidate, setCandidate] = useState<WearableScanCandidate | null>(null);
  const probeGenerationRef = useRef(0);

  const runProbe = useCallback(() => {
    const trimmedId = deviceId?.trim() ?? "";
    if (!enabled || !trimmedId) {
      setProbing(false);
      setAvailable(null);
      setCandidate(null);
      return;
    }

    const generation = probeGenerationRef.current + 1;
    probeGenerationRef.current = generation;
    setProbing(true);
    setAvailable(null);
    setCandidate(null);

    void (async () => {
      const manager = getWearableBleManager();
      try {
        const state = await manager.state();
        if (probeGenerationRef.current !== generation) return;
        if (state !== "PoweredOn") {
          setProbing(false);
          setAvailable(false);
          setCandidate(null);
          return;
        }

        const connectedDevices = await manager.connectedDevices([HEART_RATE_SERVICE_UUID]);
        if (probeGenerationRef.current !== generation) return;

        const device =
          connectedDevices.find((entry) => entry.id === trimmedId) ?? null;

        if (device) {
          const name = device.localName?.trim() || device.name?.trim() || "";
          setProbing(false);
          setAvailable(true);
          setCandidate(
            describeWearableCandidate({
              id: device.id,
              name,
              localName: device.localName,
              rssi: device.rssi ?? null,
              hasHeartRateService: true,
              isConnectable: device.isConnectable ?? null,
            }),
          );
          return;
        }

        let finished = false;
        const finishUnavailable = async () => {
          if (finished || probeGenerationRef.current !== generation) return;
          finished = true;
          try {
            await manager.stopDeviceScan();
          } catch {
            // ignore scan stop races
          }
          if (probeGenerationRef.current !== generation) return;
          setProbing(false);
          setAvailable(false);
          setCandidate(null);
        };
        const finishWithDevice = async (foundDevice: Parameters<typeof describeWearableCandidate>[0]) => {
          if (finished || probeGenerationRef.current !== generation) return;
          finished = true;
          try {
            await manager.stopDeviceScan();
          } catch {
            // ignore scan stop races
          }
          if (probeGenerationRef.current !== generation) return;
          setProbing(false);
          setAvailable(true);
          setCandidate(describeWearableCandidate(foundDevice));
        };

        const timeoutId = setTimeout(() => {
          void finishUnavailable();
        }, REMEMBERED_PROBE_TIMEOUT_MS);
        await manager.startDeviceScan([HEART_RATE_SERVICE_UUID], REMEMBERED_PROBE_SCAN_OPTIONS, (error, scannedDevice) => {
          if (finished || probeGenerationRef.current !== generation) return;
          if (error) {
            clearTimeout(timeoutId);
            void finishUnavailable();
            return;
          }
          if (!scannedDevice || scannedDevice.id !== trimmedId) return;
          clearTimeout(timeoutId);
          const name = scannedDevice.localName?.trim() || scannedDevice.name?.trim() || "";
          void finishWithDevice({
            id: scannedDevice.id,
            name,
            localName: scannedDevice.localName,
            rssi: scannedDevice.rssi ?? null,
            hasHeartRateService: true,
            isConnectable: scannedDevice.isConnectable ?? null,
          });
        });
      } catch {
        if (probeGenerationRef.current !== generation) return;
        setProbing(false);
        setAvailable(false);
        setCandidate(null);
      }
    })();
  }, [deviceId, enabled]);

  useEffect(() => {
    runProbe();
    return () => {
      probeGenerationRef.current += 1;
    };
  }, [runProbe]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        runProbe();
      }
    });
    return () => sub.remove();
  }, [runProbe]);

  return {
    probing,
    available,
    candidate,
    refresh: runProbe,
  };
}
