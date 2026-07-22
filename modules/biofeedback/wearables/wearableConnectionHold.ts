/**
 * Android: open a pure BLE GATT link (no classic pairing API) and wait for a
 * sustained Heart Rate stream before treating the strap as linked.
 *
 * Polar H10 does not need createBond for HR Service 0x180D — we never call bond
 * APIs. System banners may still appear once or twice on the first GATT + notify
 * setup; we keep that work in the catalog picker and reuse the open link.
 */
import { Platform } from "react-native";
import type { Device, Subscription } from "@sfourdrinier/react-native-ble-plx";

import { ensureAndroidBlePermissions } from "@/modules/biofeedback/wearables/androidBlePermissions";
import { getWearableBleManager } from "@/modules/biofeedback/wearables/bleManager";
import {
  HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID_FULL,
  HEART_RATE_SERVICE_UUID,
  HEART_RATE_SERVICE_UUID_FULL,
} from "@/modules/biofeedback/wearables/heartRateMeasurement";

const CONNECT_TIMEOUT_MS = 15_000;
const FIRST_PACKET_TIMEOUT_MS = 25_000;
/** Require several HR notifies so we don't flash «Подключен» mid OS-dialog. */
const MIN_LIVE_PACKETS = 3;
const MIN_LIVE_SPAN_MS = 900;

let heldDeviceId: string | null = null;
let heldDevice: Device | null = null;
let lastLivePacketAtMs: number | null = null;
let heldPacketCount = 0;
let heldHrSub: Subscription | null = null;
let warmInFlight: Promise<boolean> | null = null;

const IS_ANDROID = Platform.OS === "android";

function connectOptions() {
  // Android: omit requestMTU — Polar HR works on default MTU; MTU negotiation
  // has been observed to escalate into system pairing UI on some Pixels.
  if (IS_ANDROID) {
    return { autoConnect: false as const, timeout: CONNECT_TIMEOUT_MS };
  }
  return { autoConnect: false as const, timeout: CONNECT_TIMEOUT_MS, requestMTU: 185 };
}

function clearHeldHrMonitor() {
  try {
    heldHrSub?.remove();
  } catch {
    /* ignore */
  }
  heldHrSub = null;
  const id = heldDeviceId;
  if (id) {
    void getWearableBleManager()
      .cancelTransaction(`wearable-hold-hr-${id}`)
      .catch(() => undefined);
  }
}

export function getHeldWearableDeviceId(): string | null {
  return heldDeviceId;
}

/** True when we recently saw HR notifications on the held GATT link. */
export function isWearableLiveLinkReady(deviceId: string, maxAgeMs = 8_000): boolean {
  const trimmed = deviceId.trim();
  if (!trimmed || heldDeviceId !== trimmed) return false;
  if (lastLivePacketAtMs == null) return false;
  if (heldPacketCount < MIN_LIVE_PACKETS) return false;
  return Date.now() - lastLivePacketAtMs <= maxAgeMs;
}

export async function isWearableConnectionHeld(deviceId: string): Promise<boolean> {
  const trimmed = deviceId.trim();
  if (!trimmed) return false;
  if (heldDeviceId === trimmed && heldDevice) {
    try {
      const connected = await heldDevice.isConnected();
      if (connected) return true;
    } catch {
      /* fall through */
    }
  }
  try {
    const manager = getWearableBleManager();
    const connected = await manager.connectedDevices([HEART_RATE_SERVICE_UUID]);
    return connected.some((entry) => entry.id === trimmed);
  } catch {
    return false;
  }
}

/**
 * Keep a single HR notify subscription on the hold so catalog→practice does not
 * call connectToDevice again (second Android «Запрос подключения»).
 */
function ensureHeldHrMonitor(device: Device, deviceId: string): void {
  if (heldHrSub && heldDeviceId === deviceId) return;
  clearHeldHrMonitor();
  const transactionId = `wearable-hold-hr-${deviceId}`;
  try {
    heldHrSub = device.monitorCharacteristicForService(
      HEART_RATE_SERVICE_UUID_FULL,
      HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID_FULL,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        lastLivePacketAtMs = Date.now();
        heldPacketCount += 1;
      },
      transactionId,
    );
  } catch {
    heldHrSub = null;
  }
}

async function waitForSustainedHeartRate(device: Device, deviceId: string): Promise<boolean> {
  ensureHeldHrMonitor(device, deviceId);
  const startedAt = Date.now();
  const baselineCount = heldPacketCount;
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const gained = heldPacketCount - baselineCount;
      const spanOk =
        lastLivePacketAtMs != null && lastLivePacketAtMs - startedAt >= MIN_LIVE_SPAN_MS;
      if (gained >= MIN_LIVE_PACKETS && (spanOk || gained >= MIN_LIVE_PACKETS + 2)) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (elapsed >= FIRST_PACKET_TIMEOUT_MS) {
        clearInterval(timer);
        resolve(false);
      }
    }, 120);
  });
}

/**
 * Open (or reuse) GATT and, on Android, wait until a short sustained HR stream.
 * Best-effort; never throws. Leaves the GATT link + HR monitor open for practice.
 */
export async function ensureWearableLiveLink(deviceId: string): Promise<boolean> {
  const trimmed = deviceId.trim();
  if (!trimmed) return false;
  if (warmInFlight) {
    return warmInFlight;
  }
  warmInFlight = (async () => {
    const blePerms = await ensureAndroidBlePermissions();
    if (!blePerms.granted) return false;
    const manager = getWearableBleManager();
    const state = await manager.state();
    if (state !== "PoweredOn") return false;

    if (heldDeviceId && heldDeviceId !== trimmed) {
      await releaseWearableConnection();
    }

    // Already verified live — do not touch GATT (avoids a second OS pair banner).
    if (IS_ANDROID && isWearableLiveLinkReady(trimmed, 12_000)) {
      return true;
    }

    try {
      let device =
        (await manager.connectedDevices([HEART_RATE_SERVICE_UUID])).find(
          (entry) => entry.id === trimmed,
        ) ?? null;

      const hadGatt = Boolean(device);
      if (!device) {
        device = await manager.connectToDevice(trimmed, connectOptions());
      }

      const ready = await device.discoverAllServicesAndCharacteristics();
      heldDevice = ready;
      heldDeviceId = trimmed;
      if (!hadGatt) {
        heldPacketCount = 0;
        lastLivePacketAtMs = null;
      }

      if (!IS_ANDROID) {
        ensureHeldHrMonitor(ready, trimmed);
        return true;
      }

      if (isWearableLiveLinkReady(trimmed, 5_000)) {
        return true;
      }

      const gotStream = await waitForSustainedHeartRate(ready, trimmed);
      if (!gotStream) {
        // Keep GATT open for retry; do not claim «Подключен».
        return false;
      }
      return true;
    } catch {
      clearHeldHrMonitor();
      heldDevice = null;
      heldDeviceId = null;
      lastLivePacketAtMs = null;
      heldPacketCount = 0;
      return false;
    }
  })();
  try {
    return await warmInFlight;
  } finally {
    warmInFlight = null;
  }
}

/** @deprecated Prefer ensureWearableLiveLink — kept for call sites that only need GATT. */
export async function warmWearableConnection(deviceId: string): Promise<boolean> {
  return ensureWearableLiveLink(deviceId);
}

/**
 * Practice screen takes the notify subscription. Keep GATT + freshness so we
 * do not call connectToDevice again (that re-raises Android pair banners).
 */
export function adoptHeldWearableConnection(deviceId: string): void {
  const trimmed = deviceId.trim();
  if (!trimmed || heldDeviceId !== trimmed) return;
  // One monitor at a time — practice BleHeartRateSource will subscribe next.
  clearHeldHrMonitor();
}

export function peekHeldLivePacketAgeMs(): number | null {
  if (lastLivePacketAtMs == null) return null;
  return Date.now() - lastLivePacketAtMs;
}

export async function releaseWearableConnection(): Promise<void> {
  const id = heldDeviceId;
  const device = heldDevice;
  clearHeldHrMonitor();
  heldDeviceId = null;
  heldDevice = null;
  lastLivePacketAtMs = null;
  heldPacketCount = 0;
  if (!id && !device) return;
  try {
    if (device) await device.cancelConnection();
  } catch {
    /* ignore */
  }
  if (id) {
    try {
      await getWearableBleManager().cancelDeviceConnection(id);
    } catch {
      /* ignore */
    }
  }
}
