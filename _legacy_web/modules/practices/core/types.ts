import type { Chakra } from "@/modules/breath";
import type { BreathPracticeId } from "@/modules/breath";

export type PracticeKind = "meditation" | "breath" | "yoga";
export type BreathSensorMode = "fingerCamera" | "ble" | "none";
export type WearableCapabilityTier = "unknown" | "fullMetrics" | "guidedOnly" | "unsupported";
export type WearableDeviceProvider = "genericHrs" | "polar" | "magene" | "coospo" | "unknown";

export type PracticeDurationPolicy = "fixed" | "user_selectable";

export type PracticeSource = "static" | "breath_catalog" | "supabase";

export type PracticeDurationBucket = "any" | "short" | "medium" | "long";

export interface PracticeCatalogFilters {
  chakra?: Chakra | "any";
  duration?: PracticeDurationBucket;
}

export interface PracticeVideoMetadata {
  provider: "youtube" | "vimeo" | "vk_video" | "rutube" | string;
  url?: string;
  externalId?: string;
  thumbnail?: PracticeVideoThumbnail | null;
}

export interface PracticeVideoThumbnail {
  url: string;
  width: number;
  height: number;
}

export interface BreathWearableSelection {
  sensorMode: BreathSensorMode;
  deviceId?: string;
  deviceName?: string;
  provider?: WearableDeviceProvider;
  capabilityTier?: WearableCapabilityTier;
  connectionHint?: string;
  autoReconnect?: boolean;
}

export type PracticeLaunchParams =
  | {
      kind: "breath";
      route: "/breath-coherence";
      practiceId: BreathPracticeId;
      durationMs: number;
      chakra: Chakra;
      sensorMode?: BreathSensorMode;
      deviceId?: string;
      deviceName?: string;
      provider?: WearableDeviceProvider;
      capabilityTier?: WearableCapabilityTier;
      connectionHint?: string;
      autoReconnect?: boolean;
      /** Legacy param kept for existing deep links and assistant payloads. */
      usePulseSensor?: boolean;
    }
  | {
      kind: "meditation";
      route: "/sacred-symbol-stream";
      practiceId: string;
      durationMs?: number;
      chakra?: Chakra;
    }
  | {
      kind: "yoga";
      route: "/asana-practice";
      practiceId: string;
      durationMs?: number;
      chakra?: Chakra;
      /** Catalog already knows the Vimeo id — pass through so the player need not wait on Supabase. */
      vimeoId?: string;
    };

export interface PracticeSummary {
  id: string;
  slug: string;
  kind: PracticeKind;
  title: string;
  subtitle?: string;
  description?: string;
  defaultDurationSec?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  durationPolicy: PracticeDurationPolicy;
  chakraIds: Chakra[];
  primaryChakra?: Chakra;
  quality?: number;
  recordedAt?: string;
  source: PracticeSource;
  video?: PracticeVideoMetadata;
  params?: Record<string, unknown>;
  launch: PracticeLaunchParams;
}

export interface PracticeCatalog {
  meditation: PracticeSummary[];
  breath: PracticeSummary[];
  yoga: PracticeSummary[];
}

export const PRACTICE_GROUPS = [
  { kind: "meditation", title: "Медитации" },
  { kind: "breath", title: "Дыхание" },
  { kind: "yoga", title: "Асаны" },
] as const satisfies readonly { kind: PracticeKind; title: string }[];
