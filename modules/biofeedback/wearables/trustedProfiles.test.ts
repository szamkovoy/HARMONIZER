import { describe, expect, it } from "vitest";

import {
  describeWearableCandidate,
  detectWearableTrustedProfile,
} from "@/modules/biofeedback/wearables/trustedProfiles";

describe("detectWearableTrustedProfile", () => {
  it("recognizes trusted Polar profiles", () => {
    expect(detectWearableTrustedProfile("Polar H10")?.id).toBe("polar-h10");
    expect(detectWearableTrustedProfile("POLAR H9")?.id).toBe("polar-h9");
  });

  it("returns null for generic devices", () => {
    expect(detectWearableTrustedProfile("Some BLE HR")).toBeNull();
  });
});

describe("describeWearableCandidate", () => {
  it("marks trusted Polar devices as full metrics", () => {
    const candidate = describeWearableCandidate({
      id: "polar-1",
      name: "Polar H10",
      localName: "Polar H10",
      rssi: -45,
      hasHeartRateService: true,
      isConnectable: true,
    });
    expect(candidate.provider).toBe("polar");
    expect(candidate.capabilityTier).toBe("fullMetrics");
    expect(candidate.connectionHint).toBe("pairInAppOnly");
  });

  it("keeps generic devices probe-based", () => {
    const candidate = describeWearableCandidate({
      id: "generic-1",
      name: "HRM Band",
      localName: "HRM Band",
      rssi: -60,
      hasHeartRateService: true,
      isConnectable: true,
    });
    expect(candidate.provider).toBe("genericHrs");
    expect(candidate.capabilityTier).toBe("unknown");
    expect(candidate.connectionHint).toBe("scanStandardHrs");
  });
});
