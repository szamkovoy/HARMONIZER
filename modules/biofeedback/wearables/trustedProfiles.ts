import type {
  WearableDeviceProvider,
  WearableScanCandidate,
  WearableTrustedProfile,
} from "@/modules/biofeedback/wearables/types";

const TRUSTED_PROFILES: readonly WearableTrustedProfile[] = [
  {
    id: "polar-h10",
    provider: "polar",
    namePattern: /\bpolar\s*h10\b/i,
    capabilityTier: "fullMetrics",
    prefersPairInAppOnly: true,
    enhancedMode: "polar",
  },
  {
    id: "polar-h9",
    provider: "polar",
    namePattern: /\bpolar\s*h9\b/i,
    capabilityTier: "fullMetrics",
    prefersPairInAppOnly: true,
    enhancedMode: "polar",
  },
];

function providerFromName(name: string): WearableDeviceProvider {
  if (/polar/i.test(name)) return "polar";
  if (/magene/i.test(name)) return "magene";
  if (/coospo/i.test(name)) return "coospo";
  return "genericHrs";
}

export function detectWearableTrustedProfile(
  deviceName: string | null | undefined,
): WearableTrustedProfile | null {
  const normalized = deviceName?.trim();
  if (!normalized) return null;
  return TRUSTED_PROFILES.find((profile) => profile.namePattern.test(normalized)) ?? null;
}

export function describeWearableCandidate(args: {
  id: string;
  name: string;
  localName?: string | null;
  rssi: number | null;
  hasHeartRateService: boolean;
  isConnectable: boolean | null;
}): WearableScanCandidate {
  const preferredName = args.localName?.trim() || args.name.trim() || "BLE HR";
  const trusted = detectWearableTrustedProfile(preferredName);
  const provider = trusted?.provider ?? providerFromName(preferredName);
  return {
    id: args.id,
    name: preferredName,
    localName: args.localName,
    rssi: args.rssi,
    hasHeartRateService: args.hasHeartRateService,
    isConnectable: args.isConnectable,
    provider,
    trustedProfileId: trusted?.id,
    capabilityTier: trusted?.capabilityTier ?? "unknown",
    connectionHint: trusted?.prefersPairInAppOnly
      ? "pairInAppOnly"
      : args.hasHeartRateService
        ? "scanStandardHrs"
        : "probeBeforeUse",
  };
}
