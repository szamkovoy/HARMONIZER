import { describe, expect, it } from "vitest";

import { pickCabinetCountry } from "@/modules/account/core/cabinetCountry";

describe("pickCabinetCountry", () => {
  it("uses GPS profile country even when IP disagrees (VPN)", () => {
    expect(pickCabinetCountry("ru", "DE")).toEqual({ country: "RU", source: "profile" });
  });

  it("uses IP only when the GPS country field is empty", () => {
    expect(pickCabinetCountry("", "de")).toEqual({ country: "DE", source: "ip" });
    expect(pickCabinetCountry("  ", "US")).toEqual({ country: "US", source: "ip" });
    expect(pickCabinetCountry(null, "NL")).toEqual({ country: "NL", source: "ip" });
  });

  it("returns none when both sources are empty or invalid", () => {
    expect(pickCabinetCountry("", "")).toEqual({ country: "", source: "none" });
    expect(pickCabinetCountry("RUS", "???")).toEqual({ country: "", source: "none" });
  });

  it("ignores invalid profile codes and falls back to IP", () => {
    expect(pickCabinetCountry("RUS", "NL")).toEqual({ country: "NL", source: "ip" });
  });
});
