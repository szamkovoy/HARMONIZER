import { describe, expect, it } from "vitest";

import {
  hasHeartRateServiceUuid,
  HEART_RATE_SERVICE_UUID_FULL,
  parseHeartRateMeasurement,
} from "@/modules/biofeedback/wearables/heartRateMeasurement";

function base64(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

describe("parseHeartRateMeasurement", () => {
  it("parses uint8 heart rate and multiple RR intervals", () => {
    const payload = base64([
      0b00010000,
      75,
      0x59,
      0x03,
      0x2e,
      0x03,
    ]);
    const packet = parseHeartRateMeasurement(payload);
    expect(packet.heartRateBpm).toBe(75);
    expect(packet.hasRrIntervals).toBe(true);
    expect(packet.rrIntervalsMs).toEqual([837, 795]);
  });

  it("parses uint16 heart rate and absent RR intervals", () => {
    const payload = base64([0b00000001, 0x34, 0x01]);
    const packet = parseHeartRateMeasurement(payload);
    expect(packet.heartRateBpm).toBe(308);
    expect(packet.rrIntervalsMs).toEqual([]);
    expect(packet.hasRrIntervals).toBe(false);
  });
});

describe("hasHeartRateServiceUuid", () => {
  it("matches both short and full UUID notation", () => {
    expect(hasHeartRateServiceUuid(["180D"])).toBe(true);
    expect(hasHeartRateServiceUuid([HEART_RATE_SERVICE_UUID_FULL])).toBe(true);
    expect(hasHeartRateServiceUuid(["1234"])).toBe(false);
  });
});
