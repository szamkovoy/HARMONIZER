import type {
  BreathSensorMode,
  WearableCapabilityTier,
  WearableDeviceProvider,
} from "@/modules/practices/core/types";

export type {
  BreathSensorMode,
  WearableCapabilityTier,
  WearableDeviceProvider,
} from "@/modules/practices/core/types";

export type WearableConnectionState =
  | "idle"
  | "waitingForBluetooth"
  | "scanning"
  | "connecting"
  | "connected"
  | "probing"
  | "ready"
  | "reconnecting"
  | "disconnected"
  | "signalLost"
  | "failed";

export interface WearableTrustedProfile {
  id: string;
  provider: WearableDeviceProvider;
  namePattern: RegExp;
  capabilityTier: Extract<WearableCapabilityTier, "fullMetrics" | "guidedOnly">;
  prefersPairInAppOnly: boolean;
  enhancedMode: "polar" | "generic";
}

export interface WearableScanCandidate {
  id: string;
  name: string;
  localName?: string | null;
  rssi: number | null;
  hasHeartRateService: boolean;
  isConnectable: boolean | null;
  provider: WearableDeviceProvider;
  trustedProfileId?: string;
  capabilityTier: WearableCapabilityTier;
  connectionHint?: string;
}

export interface WearableHeartRatePacket {
  heartRateBpm: number | null;
  rrIntervalsMs: number[];
  hasRrIntervals: boolean;
  sensorContactDetected: boolean | null;
  energyExpendedKj: number | null;
}

export interface WearableRuntimeSnapshot {
  state: WearableConnectionState;
  deviceId?: string;
  deviceName?: string;
  provider?: WearableDeviceProvider;
  capabilityTier?: WearableCapabilityTier;
  connectionHint?: string;
  lastHeartRateBpm?: number | null;
  lastRrAtMs?: number | null;
  sensorContactDetected?: boolean | null;
  packetCount?: number;
  rrPacketCount?: number;
  disconnectCount?: number;
  errorMessage?: string | null;
}

export interface WearablePreferences {
  preferredSensorMode: BreathSensorMode;
  autoReconnect: boolean;
  lastDeviceId: string | null;
  lastDeviceName: string | null;
  lastProvider: WearableDeviceProvider | null;
  lastCapabilityTier: WearableCapabilityTier | null;
}
