import Constants from "expo-constants";
import { cacheDirectory, getContentUriAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { useEffect, useRef } from "react";
import { AppState, Platform, Share } from "react-native";

import {
  getBatteryLevelPct,
  getNativeMemoryMb,
  getThermalState,
  type ThermalState,
} from "@/modules/biofeedback-finger-frame-processor/src";
import { readJsHeapUsedBytes } from "@/modules/breath/debug/session-runtime-diagnostics";

type RuntimeDiagnosticsLevel = "debug" | "info" | "warn" | "error";

export type RuntimeDiagnosticsEvent = {
  seq: number;
  at: string;
  tMs: number;
  level: RuntimeDiagnosticsLevel;
  name: string;
  data?: Record<string, unknown>;
};

type RuntimeDeviceSnapshot = {
  appState: string;
  batteryLevelPct: number | null;
  nativeMemoryMb: number | null;
  thermalState: ThermalState | null;
  usedJsHeapBytes: number | null;
};

const MAX_EVENTS = 2500;
const SAMPLE_MS = 5000;
const JS_LAG_TICK_MS = 1000;

const startedAtMs = Date.now();
let sequence = 0;
let events: RuntimeDiagnosticsEvent[] = [];
let lastJsLagMs: number | null = null;
let latestSnapshot: RuntimeDeviceSnapshot = {
  appState: AppState.currentState,
  batteryLevelPct: null,
  nativeMemoryMb: null,
  thermalState: null,
  usedJsHeapBytes: null,
};

function sanitizeData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  try {
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  } catch {
    return { unserializable: true };
  }
}

export function logRuntimeEvent(
  name: string,
  data?: Record<string, unknown>,
  level: RuntimeDiagnosticsLevel = "info",
): void {
  const event: RuntimeDiagnosticsEvent = {
    seq: ++sequence,
    at: new Date().toISOString(),
    tMs: Date.now() - startedAtMs,
    level,
    name,
    data: sanitizeData(data),
  };
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS);
  }
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log("[runtimeDiagnostics]", name, event.data ?? "");
  }
}

export function logRuntimeTap(name: string, data?: Record<string, unknown>): void {
  logRuntimeEvent(`tap:${name}`, data, "debug");
}

export function clearRuntimeDiagnostics(): void {
  events = [];
  sequence = 0;
  logRuntimeEvent("diagnostics:cleared");
}

export function getRuntimeDiagnosticsCurrentSeq(): number {
  return sequence;
}

export function getRuntimeDiagnosticsEventsSince(seqExclusive: number): RuntimeDiagnosticsEvent[] {
  if (!Number.isFinite(seqExclusive) || seqExclusive < 0) {
    return events.slice();
  }
  return events.filter((event) => event.seq > seqExclusive);
}

async function sampleDevice(): Promise<void> {
  const [batteryLevelPct, nativeMemoryMb, thermalState] = await Promise.all([
    getBatteryLevelPct(),
    getNativeMemoryMb(),
    getThermalState().catch(() => null),
  ]);
  latestSnapshot = {
    appState: AppState.currentState,
    batteryLevelPct,
    nativeMemoryMb,
    thermalState,
    usedJsHeapBytes: readJsHeapUsedBytes(),
  };
  logRuntimeEvent("diagnostics:sample", {
    ...latestSnapshot,
    jsLagMs: lastJsLagMs,
  }, "debug");
}

export function useRuntimeDiagnosticsSampler(): void {
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    logRuntimeEvent("diagnostics:start", {
      appOwnership: Constants.appOwnership ?? null,
      executionEnvironment: Constants.executionEnvironment ?? null,
      platform: Platform.OS,
      platformVersion: Platform.Version,
    });

    let expectedLagTickAt = Date.now() + JS_LAG_TICK_MS;
    const lagId = setInterval(() => {
      const now = Date.now();
      lastJsLagMs = Math.max(0, now - expectedLagTickAt);
      expectedLagTickAt = now + JS_LAG_TICK_MS;
    }, JS_LAG_TICK_MS);

    const sampleId = setInterval(() => {
      void sampleDevice().catch((error: unknown) => {
        logRuntimeEvent(
          "diagnostics:sample_failed",
          { message: error instanceof Error ? error.message : String(error) },
          "warn",
        );
      });
    }, SAMPLE_MS);

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      latestSnapshot = { ...latestSnapshot, appState: nextState };
      logRuntimeEvent("app_state:change", { nextState });
    });

    void sampleDevice();

    return () => {
      clearInterval(lagId);
      clearInterval(sampleId);
      appStateSub.remove();
      logRuntimeEvent("diagnostics:stop");
    };
  }, []);
}

export function buildRuntimeDiagnosticsReport(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sessionStartedAt: new Date(startedAtMs).toISOString(),
    sessionDurationMs: Date.now() - startedAtMs,
    latestSnapshot,
    latestJsLagMs: lastJsLagMs,
    eventCount: events.length,
    events,
  };
}

export async function shareRuntimeDiagnosticsReport(): Promise<void> {
  const filePath = `${cacheDirectory ?? ""}harmonizer-runtime-${Date.now()}.json`;
  await writeAsStringAsync(filePath, JSON.stringify(buildRuntimeDiagnosticsReport(), null, 2), {
    encoding: "utf8",
  });
  const uri = Platform.OS === "ios" ? await getContentUriAsync(filePath) : filePath;
  await Share.share({
    title: "HARMONIZER runtime diagnostics",
    url: uri,
    message: uri,
  });
}
