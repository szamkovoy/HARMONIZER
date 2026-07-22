import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import type { Device, Subscription } from "@sfourdrinier/react-native-ble-plx";

import { useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import { ensureAndroidBlePermissions } from "@/modules/biofeedback/wearables/androidBlePermissions";
import { getWearableBleManager } from "@/modules/biofeedback/wearables/bleManager";
import {
  HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID_FULL,
  HEART_RATE_SERVICE_UUID,
  HEART_RATE_SERVICE_UUID_FULL,
  parseHeartRateMeasurement,
} from "@/modules/biofeedback/wearables/heartRateMeasurement";
import { adoptHeldWearableConnection } from "@/modules/biofeedback/wearables/wearableConnectionHold";
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

/**
 * Android may show a system «Запрос подключения» on each fresh `connectToDevice`.
 * After the first ready stream we must NOT cancel/reconnect while packets still
 * arrive — that re-raises the banner every ~15s even when HR is live.
 */
const IS_ANDROID = Platform.OS === "android";

/** First retry is quick; then back off. */
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
/** Stop hammering GATT after this many failed connect cycles in one source lifetime. */
const MAX_CONNECT_ATTEMPTS = 6;
/**
 * Android: only reconnect after a *real* `onDisconnected` (not stall/notify blips).
 * Cap attempts so a dead strap does not spam the system banner.
 */
const MAX_ANDROID_RECONNECT_AFTER_READY = 2;
const CONNECT_TIMEOUT_MS = 12_000;
const GUIDED_ONLY_PROBE_PACKETS = 4;
const RR_TIMELINE_RESET_GAP_MS = 30_000;
/** No HR/RR packets while connected — treat as signal loss (iOS may reconnect). */
const PACKET_STALL_MS = 10_000;
/** Polar H10 may keep streaming HR without RR when off-body; treat as signal loss. */
const RR_STALE_SIGNAL_LOST_MS = 3_500;
const STALL_CHECK_INTERVAL_MS = 2_000;
/** Ignore notify errors if a packet arrived within this window (Android flaky callbacks). */
const FRESH_PACKET_GUARD_MS = 4_000;
/**
 * React Strict Mode / fast remount: defer Android GATT teardown so cleanup→remount
 * does not cancel a live link and force a second «Запрос подключения».
 */
const ANDROID_DISCONNECT_DEFER_MS = 450;

let pendingAndroidDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAndroidDisconnectId: string | null = null;

function clearPendingAndroidDisconnect(deviceId?: string | null) {
  if (!pendingAndroidDisconnectTimer) return;
  if (deviceId && pendingAndroidDisconnectId && pendingAndroidDisconnectId !== deviceId) return;
  clearTimeout(pendingAndroidDisconnectTimer);
  pendingAndroidDisconnectTimer = null;
  pendingAndroidDisconnectId = null;
}

function scheduleAndroidDisconnect(
  cancel: () => void,
  deviceId: string,
) {
  clearPendingAndroidDisconnect();
  pendingAndroidDisconnectId = deviceId;
  pendingAndroidDisconnectTimer = setTimeout(() => {
    pendingAndroidDisconnectTimer = null;
    pendingAndroidDisconnectId = null;
    cancel();
  }, ANDROID_DISCONNECT_DEFER_MS);
}

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
    let connectAttemptCount = 0;
    let connectInFlight = false;
    /** True after we once reached a live ready stream — unlocks limited Android reconnect. */
    let hadReadyLink = false;
    let androidReconnectsAfterReady = 0;
    let beatSourceCalibrated = false;
    let lastHeartRateBpm: number | null = null;
    let lastBeatTimestampMs: number | null = null;
    let lastRrAtMs: number | null = null;
    let lastSensorContactDetected: boolean | null = null;
    let lastPacketAtMs: number | null = null;
    // Rolling history of plausible RR (across packets) for off-body frozen-run detection.
    let recentRrMs: number[] = [];
    // Rolling HR-field history paired with `recentRrMs` — lets isFrozenRrRun distinguish a real
    // low-HRV on-body run (stable HR field consistent with RR, e.g. bhastrika) from an off-body
    // frozen stream (wild / disagreeing HR field).
    let recentHeartRateBpm: number[] = [];
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

    const reconnectDelayMs = () =>
      Math.min(
        RECONNECT_MAX_DELAY_MS,
        RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, connectAttemptCount - 1),
      );

    const scheduleReconnect = (reason: WearableRuntimeSnapshot["state"], errorMessage?: string | null) => {
      if (disposed) return;
      emitSnapshot(reason, { errorMessage: errorMessage ?? null });
      if (!autoReconnect) return;
      if (connectInFlight) return;
      // Android: never reconnect before the first ready link (banner spam on prep).
      // After ready, only onDisconnected may schedule reconnect — and only a few times.
      if (IS_ANDROID) {
        if (!hadReadyLink) return;
        if (androidReconnectsAfterReady >= MAX_ANDROID_RECONNECT_AFTER_READY) {
          emitSnapshot("failed", {
            errorMessage: errorMessage ?? "Bluetooth connection lost.",
          });
          return;
        }
        androidReconnectsAfterReady += 1;
      } else if (connectAttemptCount >= MAX_CONNECT_ATTEMPTS) {
        emitSnapshot("failed", {
          errorMessage:
            errorMessage ??
            "Bluetooth connection failed repeatedly. Close other apps using the strap, then reconnect.",
        });
        return;
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const delayMs = reconnectDelayMs();
      reconnectTimer = setTimeout(() => {
        if (!disposed) {
          void connect().catch((connectError: unknown) => {
            scheduleReconnect(
              "failed",
              connectError instanceof Error ? connectError.message : String(connectError),
            );
          });
        }
      }, delayMs);
    };

    const restartConnection = (reason: WearableRuntimeSnapshot["state"], errorMessage?: string | null) => {
      if (disposed) return;
      // Android + live packets: notify errors are often transient. Cancelling here
      // re-opens «Запрос подключения» while the footer still shows a live BPM.
      if (
        IS_ANDROID &&
        hadReadyLink &&
        lastPacketAtMs != null &&
        Date.now() - lastPacketAtMs < FRESH_PACKET_GUARD_MS
      ) {
        return;
      }
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
          // HR-only gap: mark loss for metrics, but do not tear down GATT on Android.
          emitSnapshot("signalLost");
          return;
        }
        const lastActivityMs = lastPacketAtMs ?? lastRrAtMs;
        if (lastActivityMs == null) {
          if (packetCount === 0 && nowMs - (connectStartedAtMs ?? nowMs) > PACKET_STALL_MS) {
            emitSnapshot("signalLost");
            // Android: wait for user / QC — do not cancel (banner). iOS may recover.
            if (!IS_ANDROID && hadReadyLink) {
              void connection?.cancelConnection().catch(() => undefined);
            }
          }
          return;
        }
        if (nowMs - lastActivityMs > PACKET_STALL_MS) {
          emitSnapshot("signalLost");
          // Android: never self-cancel after ready — onDisconnected handles real drops.
          if (!IS_ANDROID) {
            void connection?.cancelConnection().catch(() => undefined);
          }
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
      // beat-to-beat variance can. Accumulate the plausible RR (and the paired HR field) into a
      // rolling history and, once a frozen run is detected, stop ingesting beats and latch
      // `signalLost` so the pipeline falls through to emulated synthetic pacing instead of
      // recording fake beats (which previously produced the ~91 bpm spike and the post-gap
      // RMSSD/RSA artifacts). The HR-field guard (recentHeartRateBpm) distinguishes a real
      // low-HRV on-body run (e.g. bhastrika: stable HR consistent with RR) from off-body frozen
      // (wild/disagreeing HR) — without it, bhastrika tripped a false signalLost mid-practice
      // (field 1783123388556).
      recentRrMs = [...recentRrMs, ...onBodyRr].slice(-24);
      if (lastHeartRateBpm != null && lastHeartRateBpm > 0) {
        recentHeartRateBpm = [
          ...recentHeartRateBpm,
          ...Array(onBodyRr.length).fill(lastHeartRateBpm),
        ].slice(-24);
      }
      if (isFrozenRrRun(recentRrMs, undefined, undefined, recentHeartRateBpm)) {
        frozenRunActive = true;
        recentRrMs = [];
        recentHeartRateBpm = [];
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
      if (connectInFlight) return;
      connectInFlight = true;
      clearTimers();
      clearPendingAndroidDisconnect(deviceId);
      connectStartedAtMs = Date.now();
      lastSensorContactDetected = null;
      emitSnapshot(disconnectCount > 0 || connectAttemptCount > 0 ? "reconnecting" : "connecting");
      try {
        const blePerms = await ensureAndroidBlePermissions();
        if (!blePerms.granted) {
          emitSnapshot("failed", { errorMessage: "bluetooth_permission_denied" });
          return;
        }
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
        connectAttemptCount += 1;

        // Prefer an already-open GATT (warmed when user tapped «Подключить» / «Начать»).
        // Cancelling it would force a new Android «Запрос подключения».
        const alreadyConnected = await manager.connectedDevices([HEART_RATE_SERVICE_UUID]);
        const existing = alreadyConnected.find((entry) => entry.id === deviceId) ?? null;
        if (existing) {
          adoptHeldWearableConnection(deviceId);
          connection = await existing.discoverAllServicesAndCharacteristics();
        } else {
          // Android: do not pre-cancel — that itself can raise the system banner.
          if (!IS_ANDROID) {
            try {
              await manager.cancelDeviceConnection(deviceId);
            } catch {
              // no prior connection
            }
          }
          connection = await manager.connectToDevice(deviceId, {
            autoConnect: false,
            timeout: CONNECT_TIMEOUT_MS,
            // Android: no requestMTU — avoids escalation into system pair UI on Polar.
            ...(IS_ANDROID ? {} : { requestMTU: 185 }),
          });
        }
        if (disposed) return;

        if (!existing) {
          connection = await connection.discoverAllServicesAndCharacteristics();
        }
        if (disposed) return;
        // Successful GATT link — reset attempt budget for later dropouts.
        connectAttemptCount = 0;
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
          recentHeartRateBpm = [];
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
            hadReadyLink = true;
            androidReconnectsAfterReady = 0;
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
            if (resolvedTier === "guidedOnly" || resolvedTier === "fullMetrics") {
              hadReadyLink = true;
              androidReconnectsAfterReady = 0;
              emitSnapshot("ready");
            } else {
              emitSnapshot("probing");
            }
            ensureGuidedBeatTimer();
          },
          `wearable-hr-${deviceId}`,
        );
      } finally {
        connectInFlight = false;
      }
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
      if (!deviceId) return;
      const id = deviceId;
      const manager = managerRef.current;
      const tearDown = () => {
        void manager.cancelDeviceConnection(id).catch(() => undefined);
        void manager.cancelTransaction(`wearable-hr-${id}`).catch(() => undefined);
      };
      if (IS_ANDROID) {
        // Defer so Strict Mode remount / phase remount can reuse the GATT.
        scheduleAndroidDisconnect(tearDown, id);
      } else {
        tearDown();
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
