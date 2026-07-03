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
import { buildBeatTimestampsFromRrPacket } from "@/modules/biofeedback/wearables/wearableBeatTimeline";
import {
  deriveBpmFromWearableRrIntervals,
  filterOnBodyWearableRrIntervals,
  isFrozenRrRun,
  resolveWearableHeartRateBpm,
} from "@/modules/biofeedback/wearables/wearableRrQuality";
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
  suppressBeatEvents?: boolean;
  onRuntimeSnapshot?: (snapshot: WearableRuntimeSnapshot) => void;
  onCapabilityResolved?: (tier: WearableCapabilityTier, connectionHint?: string) => void;
};

const RECONNECT_DELAY_MS = 1500;
const GUIDED_ONLY_PROBE_PACKETS = 4;
const RR_TIMELINE_RESET_GAP_MS = 30_000;
/** No HR/RR packets while connected — treat as signal loss and reconnect. */
const PACKET_STALL_MS = 10_000;
/** Polar H10 may keep streaming HR without RR when off-body; treat as signal loss. */
const RR_STALE_SIGNAL_LOST_MS = 3_500;
const STALL_CHECK_INTERVAL_MS = 2_000;

export function BleHeartRateSource({
  isActive,
  deviceId,
  deviceName,
  initialCapabilityTier = "unknown",
  autoReconnect = true,
  suppressBeatEvents = false,
  onRuntimeSnapshot,
  onCapabilityResolved,
}: BleHeartRateSourceProps) {
  const pipeline = useBiofeedbackPipeline();
  const managerRef = useRef(getWearableBleManager());
  const runtimeSnapshotHandlerRef = useRef(onRuntimeSnapshot);
  const capabilityResolvedHandlerRef = useRef(onCapabilityResolved);
  const initialCapabilityTierRef = useRef(initialCapabilityTier);
  const suppressBeatEventsRef = useRef(suppressBeatEvents);

  useEffect(() => {
    runtimeSnapshotHandlerRef.current = onRuntimeSnapshot;
  }, [onRuntimeSnapshot]);

  useEffect(() => {
    capabilityResolvedHandlerRef.current = onCapabilityResolved;
  }, [onCapabilityResolved]);

  useEffect(() => {
    initialCapabilityTierRef.current = initialCapabilityTier;
  }, [initialCapabilityTier]);

  useEffect(() => {
    suppressBeatEventsRef.current = suppressBeatEvents;
  }, [suppressBeatEvents]);

  useEffect(() => {
    if (!isActive || !deviceId) {
      runtimeSnapshotHandlerRef.current?.({ state: "idle" });
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connection: Device | null = null;
    let disconnectSub: Subscription | null = null;
    let hrMonitorSub: Subscription | null = null;
    let btStateSub: Subscription | null = null;
    let guidedBeatTimer: ReturnType<typeof setInterval> | null = null;
    let resolvedTier: WearableCapabilityTier = initialCapabilityTierRef.current;
    let packetCount = 0;
    let rrPacketCount = 0;
    let disconnectCount = 0;
    let beatSourceCalibrated = false;
    let lastHeartRateBpm: number | null = null;
    let lastBeatTimestampMs: number | null = null;
    let lastRrAtMs: number | null = null;
    let lastSensorContactDetected: boolean | null = null;
    let lastPacketAtMs: number | null = null;
    // Rolling history of plausible RR (across packets) for off-body frozen-run detection.
    let recentRrMs: number[] = [];
    // Latched while the strap is emitting a frozen RR stream (off-body); cleared when real
    // beat-to-beat variability returns.
    let frozenRunActive = false;
    let stallWatchdog: ReturnType<typeof setInterval> | null = null;
    const trustedProfile = detectWearableTrustedProfile(deviceName ?? undefined);
    const provider = trustedProfile?.provider ?? "genericHrs";

    const emitSnapshot = (
      state: WearableRuntimeSnapshot["state"],
      extra: Partial<WearableRuntimeSnapshot> = {},
    ) => {
      runtimeSnapshotHandlerRef.current?.({
        state,
        deviceId,
        deviceName: deviceName ?? undefined,
        provider,
        capabilityTier: resolvedTier,
        connectionHint:
          trustedProfile?.prefersPairInAppOnly === true ? "pairInAppOnly" : extra.connectionHint,
        lastHeartRateBpm,
        lastRrAtMs,
        sensorContactDetected: lastSensorContactDetected,
        packetCount,
        rrPacketCount,
        disconnectCount,
        ...extra,
      });
    };

    const applyCapabilityTier = (nextTier: WearableCapabilityTier, connectionHint?: string) => {
      resolvedTier = nextTier;
      pipeline.setMetricsCapturePaused(nextTier === "guidedOnly" || nextTier === "unsupported");
      capabilityResolvedHandlerRef.current?.(nextTier, connectionHint);
      emitSnapshot(nextTier === "unsupported" || nextTier === "unknown" ? "probing" : "ready", {
        capabilityTier: nextTier,
        connectionHint,
      });
    };

    const clearTimers = () => {
      if (guidedBeatTimer) clearInterval(guidedBeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (stallWatchdog) clearInterval(stallWatchdog);
      guidedBeatTimer = null;
      reconnectTimer = null;
      stallWatchdog = null;
    };

    const scheduleReconnect = (reason: WearableRuntimeSnapshot["state"], errorMessage?: string | null) => {
      if (disposed) return;
      emitSnapshot(reason, { errorMessage: errorMessage ?? null });
      if (!autoReconnect) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (!disposed) {
          void connect().catch((connectError: unknown) => {
            scheduleReconnect(
              "failed",
              connectError instanceof Error ? connectError.message : String(connectError),
            );
          });
        }
      }, RECONNECT_DELAY_MS);
    };

    const restartConnection = (reason: WearableRuntimeSnapshot["state"], errorMessage?: string | null) => {
      if (disposed) return;
      hrMonitorSub?.remove();
      disconnectSub?.remove();
      hrMonitorSub = null;
      disconnectSub = null;
      const activeConnection = connection;
      connection = null;
      if (activeConnection) {
        void activeConnection.cancelConnection().catch(() => undefined);
      }
      scheduleReconnect(reason, errorMessage);
    };

    const startStallWatchdog = () => {
      if (stallWatchdog) clearInterval(stallWatchdog);
      stallWatchdog = setInterval(() => {
        if (disposed || !connection) return;
        const nowMs = Date.now();
        if (
          resolvedTier === "fullMetrics" &&
          lastRrAtMs != null &&
          nowMs - lastRrAtMs > RR_STALE_SIGNAL_LOST_MS
        ) {
          emitSnapshot("signalLost");
          return;
        }
        const lastActivityMs = lastPacketAtMs ?? lastRrAtMs;
        if (lastActivityMs == null) {
          if (packetCount === 0 && nowMs - (connectStartedAtMs ?? nowMs) > PACKET_STALL_MS) {
            void connection?.cancelConnection().catch(() => undefined);
          }
          return;
        }
        if (nowMs - lastActivityMs > PACKET_STALL_MS) {
          void connection?.cancelConnection().catch(() => undefined);
        }
      }, STALL_CHECK_INTERVAL_MS);
    };

    let connectStartedAtMs: number | null = null;

    const ensureGuidedBeatTimer = () => {
      if (guidedBeatTimer) return;
      guidedBeatTimer = setInterval(() => {
        if (disposed || resolvedTier !== "guidedOnly" || !lastHeartRateBpm || lastHeartRateBpm <= 0) return;
        const intervalMs = 60_000 / lastHeartRateBpm;
        const nowMs = Date.now();
        if (!suppressBeatEventsRef.current && !beatSourceCalibrated) {
          pipeline.setPulseSource("wearable");
          pipeline.markCalibrationCompleteForBeatSource(nowMs);
          beatSourceCalibrated = true;
        }
        if (lastBeatTimestampMs == null) {
          lastBeatTimestampMs = nowMs - intervalMs;
        }
        while (lastBeatTimestampMs + intervalMs <= nowMs) {
          lastBeatTimestampMs += intervalMs;
          if (!suppressBeatEventsRef.current) {
            pipeline.setPulseSource("wearable");
            pipeline.pushBeatEvent(nowMs, lastBeatTimestampMs);
          }
        }
      }, 200);
    };

    const ingestRrIntervals = (rrIntervalsMs: readonly number[]): boolean => {
      if (!rrIntervalsMs.length) return false;
      const nowMs = Date.now();
      // Keep only usable on-body intervals; a single implausible RR (missed/merged beat) is
      // dropped without discarding the packet or flipping the runtime to `signalLost`. Losing a
      // couple of beats must NOT read as a signal-loss gap on-body. Sustained loss is handled by
      // the RR-staleness watchdog (`RR_STALE_SIGNAL_LOST_MS`) and the sensor-contact bit.
      const onBodyRr = filterOnBodyWearableRrIntervals(rrIntervalsMs);
      if (!onBodyRr.length) {
        // Nothing usable this packet — skip it, but stay `ready`; the watchdog decides real loss.
        return false;
      }
      // Off-body frozen-run detection: Polar H10 lifted off the chest keeps streaming a
      // near-constant RR (field test 1783096820335: exact 659 ms → bogus 91 bpm) with no real
      // cardiac waveform. The range filter above cannot catch it (659 ms is in range); only
      // beat-to-beat variance can. Accumulate the plausible RR into a rolling history and, once a
      // frozen run is detected, stop ingesting beats and latch `signalLost` so the pipeline falls
      // through to emulated synthetic pacing instead of recording fake beats (which previously
      // produced the ~91 bpm spike and the post-gap RMSSD/RSA artifacts). Real RR vary ≥10 ms
      // beat-to-beat, so a tight tolerance cleanly separates off-body from low-HRV on-body.
      recentRrMs = [...recentRrMs, ...onBodyRr].slice(-24);
      if (isFrozenRrRun(recentRrMs)) {
        frozenRunActive = true;
        recentRrMs = [];
        emitSnapshot("signalLost");
        return false;
      }
      if (frozenRunActive) {
        // Was frozen; the new packet's RR vary again → real signal returned. Reset the timeline
        // so the off-body frozen beats don't seed the post-return timeline.
        frozenRunActive = false;
        lastBeatTimestampMs = null;
      }
      const gapSinceLastPacketMs =
        lastRrAtMs == null ? Number.POSITIVE_INFINITY : nowMs - lastRrAtMs;
      const resetTimeline = gapSinceLastPacketMs > RR_TIMELINE_RESET_GAP_MS;
      const { beatTimestampsMs, lastBeatTimestampMs: nextLastBeat } =
        buildBeatTimestampsFromRrPacket(nowMs, onBodyRr, lastBeatTimestampMs, {
          resetTimeline,
        });
      if (!suppressBeatEventsRef.current && !beatSourceCalibrated) {
        pipeline.setPulseSource("wearable");
        pipeline.markCalibrationCompleteForBeatSource(nowMs);
        beatSourceCalibrated = true;
      }
      for (const beatTimestampMs of beatTimestampsMs) {
        if (!suppressBeatEventsRef.current) {
          pipeline.pushBeatEvent(nowMs, beatTimestampMs);
        }
      }
      if (nextLastBeat != null) {
        lastBeatTimestampMs = nextLastBeat;
      }
      lastRrAtMs = nowMs;
      return true;
    };

    const connect = async () => {
      clearTimers();
      connectStartedAtMs = Date.now();
      lastSensorContactDetected = null;
      emitSnapshot(disconnectCount > 0 ? "reconnecting" : "connecting");
      const manager = managerRef.current;
      const state = await manager.state();
      if (state !== "PoweredOn") {
        emitSnapshot("waitingForBluetooth");
        btStateSub?.remove();
        btStateSub = manager.onStateChange((nextState) => {
          if (disposed) return;
          if (nextState === "PoweredOn") {
            btStateSub?.remove();
            btStateSub = null;
            void connect().catch((error: unknown) => {
              scheduleReconnect("failed", error instanceof Error ? error.message : String(error));
            });
          }
        }, false);
        return;
      }

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
      startStallWatchdog();

      disconnectSub = connection.onDisconnected((error) => {
        if (disposed) return;
        disconnectCount += 1;
        const lastPacketBeforeDisconnect = lastPacketAtMs;
        lastBeatTimestampMs = null;
        lastRrAtMs = null;
        lastSensorContactDetected = null;
        lastPacketAtMs = null;
        recentRrMs = [];
        frozenRunActive = false;
        if (stallWatchdog) clearInterval(stallWatchdog);
        stallWatchdog = null;
        const stallLikely =
          error == null &&
          packetCount > 0 &&
          lastPacketBeforeDisconnect != null &&
          Date.now() - lastPacketBeforeDisconnect > PACKET_STALL_MS / 2;
        scheduleReconnect(stallLikely ? "signalLost" : "disconnected", error?.message ?? null);
      });

      emitSnapshot("probing");
      hrMonitorSub = connection.monitorCharacteristicForService(
        HEART_RATE_SERVICE_UUID_FULL,
        HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID_FULL,
        (error, characteristic) => {
          if (disposed) return;
          if (error) {
            restartConnection("failed", error.message);
            return;
          }
          if (!characteristic?.value) return;
          lastPacketAtMs = Date.now();
          const packet = parseHeartRateMeasurement(characteristic.value);
          lastSensorContactDetected = packet.sensorContactDetected;
          packetCount += 1;
          if (packet.sensorContactDetected === false) {
            emitSnapshot("signalLost");
            return;
          }
          const rrDerivedBpm = deriveBpmFromWearableRrIntervals(packet.rrIntervalsMs);
          const resolvedHeartRateBpm = resolveWearableHeartRateBpm(
            packet.heartRateBpm,
            rrDerivedBpm,
          );
          if (resolvedHeartRateBpm != null && resolvedHeartRateBpm > 0) {
            lastHeartRateBpm = Math.round(resolvedHeartRateBpm);
          }
          if (packet.rrIntervalsMs.length > 0) {
            rrPacketCount += 1;
            if (resolvedTier !== "fullMetrics") {
              applyCapabilityTier(
                trustedProfile?.enhancedMode === "polar" ? "fullMetrics" : "fullMetrics",
                trustedProfile?.enhancedMode === "polar" ? "polarEnhanced" : "genericRr",
              );
            }
            // Ingest whatever on-body RR the packet carries. Even if this specific packet had no
            // usable RR (a rare all-garbage burst), the link is still up, so we stay `ready` and
            // let the RR-staleness watchdog declare a real loss only if it persists. This stops
            // single fast-HR / missed-beat packets from tearing 1–4 s "signal lost" bands into an
            // on-body Polar stream.
            ingestRrIntervals(packet.rrIntervalsMs);
            emitSnapshot("ready");
            return;
          }

          if (
            resolvedTier === "fullMetrics" &&
            lastRrAtMs != null &&
            Date.now() - lastRrAtMs > RR_STALE_SIGNAL_LOST_MS
          ) {
            emitSnapshot("signalLost");
            return;
          }

          if (packetCount >= GUIDED_ONLY_PROBE_PACKETS && resolvedTier !== "guidedOnly") {
            applyCapabilityTier("guidedOnly", "heartRateOnly");
          }
          emitSnapshot(
            resolvedTier === "guidedOnly" || resolvedTier === "fullMetrics" ? "ready" : "probing",
          );
          ensureGuidedBeatTimer();
        },
        `wearable-hr-${deviceId}`,
      );
    };

    void connect().catch((error: unknown) => {
      scheduleReconnect("failed", error instanceof Error ? error.message : String(error));
    });

    return () => {
      disposed = true;
      clearTimers();
      hrMonitorSub?.remove();
      disconnectSub?.remove();
      btStateSub?.remove();
      if (deviceId) {
        void managerRef.current.cancelDeviceConnection(deviceId).catch(() => undefined);
        void managerRef.current.cancelTransaction(`wearable-hr-${deviceId}`).catch(() => undefined);
      }
    };
  }, [
    autoReconnect,
    deviceId,
    deviceName,
    isActive,
    pipeline,
  ]);

  return null;
}
