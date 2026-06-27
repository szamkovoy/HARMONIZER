import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { State } from "@sfourdrinier/react-native-ble-plx";

import { getWearableBleManager } from "@/modules/biofeedback/wearables/bleManager";
import {
  hasHeartRateServiceUuid,
  HEART_RATE_SERVICE_UUID,
} from "@/modules/biofeedback/wearables/heartRateMeasurement";
import { describeWearableCandidate } from "@/modules/biofeedback/wearables/trustedProfiles";
import type {
  WearableConnectionState,
  WearableScanCandidate,
} from "@/modules/biofeedback/wearables/types";

const NAME_HINT_RE = /(polar|magene|coospo|heart|hrm|h10|h9|h6|h303|h808)/i;

/** iOS часто отдаёт неполный adv-пакет в первый раз; duplicates + окно скана дают полное имя/UUID. */
const BLE_SCAN_OPTIONS = { allowDuplicates: true } as const;

export function useWearableScanner() {
  const manager = useMemo(() => getWearableBleManager(), []);
  const [bluetoothState, setBluetoothState] = useState<keyof typeof State>("Unknown");
  const [scanState, setScanState] = useState<WearableConnectionState>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [devices, setDevices] = useState<WearableScanCandidate[]>([]);
  const seenMapRef = useRef<Map<string, WearableScanCandidate>>(new Map());
  const pendingAutoStartRef = useRef(false);
  const startScanRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const subscription = manager.onStateChange((nextState) => {
      setBluetoothState(nextState);
      if (pendingAutoStartRef.current && nextState === "PoweredOn") {
        pendingAutoStartRef.current = false;
        void startScanRef.current?.();
        return;
      }
      if (nextState !== "PoweredOn" && scanState === "scanning") {
        setScanState("waitingForBluetooth");
      }
    }, true);
    return () => subscription.remove();
  }, [manager, scanState]);

  const stopScan = useCallback(async () => {
    pendingAutoStartRef.current = false;
    try {
      await manager.stopDeviceScan();
    } catch {
      // ignore stop races
    }
    setScanState((prev) => (prev === "scanning" ? "idle" : prev));
  }, [manager]);

  const startScan = useCallback(async () => {
    setScanError(null);
    seenMapRef.current = new Map();
    setDevices([]);
    try {
      await manager.stopDeviceScan();
    } catch {
      // ignore restart races
    }
    const state = await manager.state();
    setBluetoothState(state);
    if (state !== "PoweredOn") {
      pendingAutoStartRef.current = true;
      setScanState("waitingForBluetooth");
      return;
    }
    pendingAutoStartRef.current = false;
    setScanState("scanning");
    await manager.startDeviceScan([HEART_RATE_SERVICE_UUID], BLE_SCAN_OPTIONS, (error, scannedDevice) => {
      if (error) {
        setScanError(error.message);
        setScanState("failed");
        return;
      }
      if (!scannedDevice) return;
      const name = scannedDevice.localName?.trim() || scannedDevice.name?.trim() || "";
      const hasHrService = hasHeartRateServiceUuid(scannedDevice.serviceUUIDs);
      if (!hasHrService && !NAME_HINT_RE.test(name)) {
        return;
      }
      const previous = seenMapRef.current.get(scannedDevice.id);
      const candidate = describeWearableCandidate({
        id: scannedDevice.id,
        name: name || previous?.name || "",
        localName: scannedDevice.localName ?? previous?.localName,
        rssi: scannedDevice.rssi ?? previous?.rssi ?? null,
        hasHeartRateService: hasHrService || (previous?.hasHeartRateService ?? false),
        isConnectable: scannedDevice.isConnectable ?? previous?.isConnectable ?? null,
      });
      if (!candidate.name.trim() && !candidate.hasHeartRateService) {
        return;
      }
      seenMapRef.current.set(candidate.id, candidate);
      const next = [...seenMapRef.current.values()].sort((left, right) => {
        const leftHr = left.hasHeartRateService ? 1 : 0;
        const rightHr = right.hasHeartRateService ? 1 : 0;
        if (rightHr !== leftHr) return rightHr - leftHr;
        return (right.rssi ?? -200) - (left.rssi ?? -200);
      });
      setDevices(next);
    });
  }, [manager]);

  useEffect(() => {
    startScanRef.current = startScan;
  }, [startScan]);

  useEffect(() => {
    return () => {
      pendingAutoStartRef.current = false;
      void manager.stopDeviceScan();
    };
  }, [manager]);

  return {
    bluetoothState,
    scanState,
    scanError,
    devices,
    startScan,
    stopScan,
  };
}
