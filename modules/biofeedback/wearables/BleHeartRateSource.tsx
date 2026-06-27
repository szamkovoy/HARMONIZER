import { useEffect, useRef } from "react";

import type { Device, Subscription } from "@sfourdrinier/react-native-ble-plx";

import { useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import { getWearableBleManager } from "@/modules/biofeedback/wearables/bleManager";
import {
  HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID_FULL,
  HEART_RATE_SERVICE_UUID_FULL,
  parseHeartRateMeasurement,
} from "@/modules/biofeedback/wearables/heartRateMeasurement";
import { detectWearableTrustedProfile } from "@/modules/biofeedback/wearables/trustedProfiles";
import type {
  WearableCapabilityTier,
  WearableRuntimeSnapshot,
} from "@/modules/biofeedback/wearables/types";

type BleHeartRateSourceProps = {
  isActive: boolean;
  deviceId?: string | null;
  deviceName?: string | null;
  initialCapabilityTier?: WearableCapabilityTier;
  autoReconnect?: boolean;
  onRuntimeSnapshot?: (snapshot: WearableRuntimeSnapshot) => void;
  onCapabilityResolved?: (tier: WearableCapabilityTier, connectionHint?: string) => void;
};

const RECONNECT_DELAY_MS = 1500;
const GUIDED_ONLY_PROBE_PACKETS = 4;

export function BleHeartRateSource({
  isActive,
  deviceId,
  deviceName,
  initialCapabilityTier = "unknown",
  autoReconnect = true,
  onRuntimeSnapshot,
  onCapabilityResolved,
}: BleHeartRateSourceProps) {
  const pipeline = useBiofeedbackPipeline();
  const managerRef = useRef(getWearableBleManager());

  useEffect(() => {
    if (!isActive || !deviceId) {
      onRuntimeSnapshot?.({ state: "idle" });
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connection: Device | null = null;
    let disconnectSub: Subscription | null = null;
    let hrMonitorSub: Subscription | null = null;
    let guidedBeatTimer: ReturnType<typeof setInterval> | null = null;
    let resolvedTier: WearableCapabilityTier = initialCapabilityTier;
    let packetCount = 0;
    let rrPacketCount = 0;
    let disconnectCount = 0;
    let lastHeartRateBpm: number | null = null;
    let lastBeatTimestampMs: number | null = null;
    let lastRrAtMs: number | null = null;
    const trustedProfile = detectWearableTrustedProfile(deviceName ?? undefined);
    const provider = trustedProfile?.provider ?? "genericHrs";

    const emitSnapshot = (
      state: WearableRuntimeSnapshot["state"],
      extra: Partial<WearableRuntimeSnapshot> = {},
    ) => {
      onRuntimeSnapshot?.({
        state,
        deviceId,
        deviceName: deviceName ?? undefined,
        provider,
        capabilityTier: resolvedTier,
        connectionHint:
          trustedProfile?.prefersPairInAppOnly === true ? "pairInAppOnly" : extra.connectionHint,
        lastHeartRateBpm,
        lastRrAtMs,
        packetCount,
        rrPacketCount,
        disconnectCount,
        ...extra,
      });
    };

    const applyCapabilityTier = (nextTier: WearableCapabilityTier, connectionHint?: string) => {
      resolvedTier = nextTier;
      pipeline.setMetricsCapturePaused(nextTier === "guidedOnly" || nextTier === "unsupported");
      onCapabilityResolved?.(nextTier, connectionHint);
      emitSnapshot(nextTier === "fullMetrics" ? "ready" : "probing", {
        capabilityTier: nextTier,
        connectionHint,
      });
    };

    const clearTimers = () => {
      if (guidedBeatTimer) clearInterval(guidedBeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      guidedBeatTimer = null;
      reconnectTimer = null;
    };

    const ensureGuidedBeatTimer = () => {
      if (guidedBeatTimer) return;
      guidedBeatTimer = setInterval(() => {
        if (disposed || resolvedTier !== "guidedOnly" || !lastHeartRateBpm || lastHeartRateBpm <= 0) return;
        const intervalMs = 60_000 / lastHeartRateBpm;
        const nowMs = Date.now();
        if (lastBeatTimestampMs == null) {
          lastBeatTimestampMs = nowMs - intervalMs;
        }
        while (lastBeatTimestampMs + intervalMs <= nowMs) {
          lastBeatTimestampMs += intervalMs;
          pipeline.pushBeatEvent(nowMs, lastBeatTimestampMs);
        }
      }, 200);
    };

    const ingestRrIntervals = (rrIntervalsMs: readonly number[]) => {
      if (!rrIntervalsMs.length) return;
      const nowMs = Date.now();
      let beatTimestampMs =
        lastBeatTimestampMs != null && nowMs - lastBeatTimestampMs <= 5000
          ? lastBeatTimestampMs
          : nowMs - rrIntervalsMs.reduce((sum, value) => sum + value, 0);
      for (const rrMs of rrIntervalsMs) {
        beatTimestampMs += rrMs;
        pipeline.pushBeatEvent(nowMs, beatTimestampMs);
      }
      lastBeatTimestampMs = beatTimestampMs;
      lastRrAtMs = nowMs;
    };

    const connect = async () => {
      clearTimers();
      emitSnapshot(disconnectCount > 0 ? "reconnecting" : "connecting");
      const manager = managerRef.current;
      const state = await manager.state();
      if (state !== "PoweredOn") {
        emitSnapshot("waitingForBluetooth");
        return;
      }

      pipeline.setPulseSource("wearable");
      pipeline.markCalibrationCompleteForBeatSource(Date.now());
      pipeline.setMetricsCapturePaused(initialCapabilityTier === "guidedOnly");

      connection = await manager.connectToDevice(deviceId, {
        autoConnect: false,
        timeout: 15_000,
        requestMTU: 185,
      });
      if (disposed) return;

      connection = await connection.discoverAllServicesAndCharacteristics();
      if (disposed) return;
      emitSnapshot("connected");

      disconnectSub = connection.onDisconnected((error) => {
        if (disposed) return;
        disconnectCount += 1;
        emitSnapshot("disconnected", {
          errorMessage: error?.message ?? null,
        });
        if (autoReconnect) {
          reconnectTimer = setTimeout(() => {
            if (!disposed) {
              void connect().catch((connectError: unknown) => {
                emitSnapshot("failed", {
                  errorMessage: connectError instanceof Error ? connectError.message : String(connectError),
                });
              });
            }
          }, RECONNECT_DELAY_MS);
        }
      });

      emitSnapshot("probing");
      hrMonitorSub = connection.monitorCharacteristicForService(
        HEART_RATE_SERVICE_UUID_FULL,
        HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID_FULL,
        (error, characteristic) => {
          if (disposed) return;
          if (error) {
            emitSnapshot("failed", { errorMessage: error.message });
            return;
          }
          if (!characteristic?.value) return;
          const packet = parseHeartRateMeasurement(characteristic.value);
          packetCount += 1;
          if (packet.heartRateBpm != null && packet.heartRateBpm > 0) {
            lastHeartRateBpm = packet.heartRateBpm;
          }
          if (packet.rrIntervalsMs.length > 0) {
            rrPacketCount += 1;
            if (resolvedTier !== "fullMetrics") {
              applyCapabilityTier(
                trustedProfile?.enhancedMode === "polar" ? "fullMetrics" : "fullMetrics",
                trustedProfile?.enhancedMode === "polar" ? "polarEnhanced" : "genericRr",
              );
            }
            ingestRrIntervals(packet.rrIntervalsMs);
            emitSnapshot("ready");
            return;
          }

          if (packetCount >= GUIDED_ONLY_PROBE_PACKETS && resolvedTier !== "guidedOnly") {
            applyCapabilityTier("guidedOnly", "heartRateOnly");
          }
          ensureGuidedBeatTimer();
        },
        `wearable-hr-${deviceId}`,
      );
    };

    void connect().catch((error: unknown) => {
      emitSnapshot("failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });

    return () => {
      disposed = true;
      clearTimers();
      hrMonitorSub?.remove();
      disconnectSub?.remove();
      if (deviceId) {
        void managerRef.current.cancelDeviceConnection(deviceId).catch(() => undefined);
        void managerRef.current.cancelTransaction(`wearable-hr-${deviceId}`).catch(() => undefined);
      }
    };
  }, [
    autoReconnect,
    deviceId,
    deviceName,
    initialCapabilityTier,
    isActive,
    onCapabilityResolved,
    onRuntimeSnapshot,
    pipeline,
  ]);

  return null;
}
