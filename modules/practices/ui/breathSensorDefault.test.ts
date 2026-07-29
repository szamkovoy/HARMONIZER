import { describe, expect, it } from "vitest";

import { shouldDemoteUnavailableBleToNone } from "./breathSensorDefault";

describe("shouldDemoteUnavailableBleToNone", () => {
  const base = {
    hasRememberedWearable: true,
    probing: false,
    available: false as boolean | null,
    liveLinkReady: false,
  };

  it("demotes when preferred BLE strap is missing", () => {
    expect(
      shouldDemoteUnavailableBleToNone({
        ...base,
        preferredSensorMode: "ble",
        selectedSensorMode: "ble",
      }),
    ).toBe(true);
  });

  it("does not demote fingerCamera after user chose phone pulse", () => {
    expect(
      shouldDemoteUnavailableBleToNone({
        ...base,
        preferredSensorMode: "fingerCamera",
        selectedSensorMode: "fingerCamera",
      }),
    ).toBe(false);
  });

  it("does not demote explicit none", () => {
    expect(
      shouldDemoteUnavailableBleToNone({
        ...base,
        preferredSensorMode: "none",
        selectedSensorMode: "none",
      }),
    ).toBe(false);
  });

  it("waits while probe is still running", () => {
    expect(
      shouldDemoteUnavailableBleToNone({
        ...base,
        preferredSensorMode: "ble",
        selectedSensorMode: "ble",
        probing: true,
        available: null,
      }),
    ).toBe(false);
  });

  it("keeps BLE when live link is still warm", () => {
    expect(
      shouldDemoteUnavailableBleToNone({
        ...base,
        preferredSensorMode: "ble",
        selectedSensorMode: "ble",
        liveLinkReady: true,
      }),
    ).toBe(false);
  });
});
