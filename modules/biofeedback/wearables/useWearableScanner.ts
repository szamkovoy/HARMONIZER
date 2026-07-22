import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { State } from "@sfourdrinier/react-native-ble-plx";

import { ensureAndroidBlePermissions } from "@/modules/biofeedback/wearables/androidBlePermissions";
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
    const blePerms = await ensureAndroidBlePermissions();
    if (!blePerms.granted) {
      setScanState("idle");
      setScanError("bluetooth_permission_denied");
      return;
    }
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
    // Seed the candidate list with peripherals already known to the OS BLE stack
    // (remembered / system-paired) BEFORE relying on advertisements. A Polar H10 that
    // the user just re-wore is often still bound to the OS (and may not advertise while
    // another Central has it, or for the first second after re-power). Without this,
    // "Найти пульсометр" repeatedly reports "не найден" even though the strap is on and
    // the system dropdown shows it — the reconnect loop the user reported.
    try {
      const known = await manager.devices([HEART_RATE_SERVICE_UUID]);
      const connected = await manager.connectedDevices([HEART_RATE_SERVICE_UUID]);
      for (const device of [...connected, ...known]) {
        const name = device.localName?.trim() || device.name?.trim() || "";
        const hasHrService = hasHeartRateServiceUuid(device.serviceUUIDs) || NAME_HINT_RE.test(name);
        if (!name && !hasHrService) continue;
        // Skip peripherals the OS reports as non-connectable (stale remembered entries).
        if (device.isConnectable === false) continue;
        const candidate = describeWearableCandidate({
          id: device.id,
          name,
          localName: device.localName ?? null,
          rssi: device.rssi ?? null,
          hasHeartRateService: hasHrService,
          isConnectable: device.isConnectable ?? null,
        });
        if (!candidate.name.trim() && !candidate.hasHeartRateService) continue;
        seenMapRef.current.set(candidate.id, candidate);
      }
      const next = [...seenMapRef.current.values()].sort((left, right) => {
        const leftHr = left.hasHeartRateService ? 1 : 0;
        const rightHr = right.hasHeartRateService ? 1 : 0;
        if (rightHr !== leftHr) return rightHr - leftHr;
        return (right.rssi ?? -200) - (left.rssi ?? -200);
      });
      if (next.length > 0) setDevices(next);
    } catch {
      // best-effort; scan below still runs
    }
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
