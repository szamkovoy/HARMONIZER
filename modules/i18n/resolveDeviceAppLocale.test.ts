import { describe, expect, it } from "vitest";

import { resolveDeviceAppLocale } from "@/modules/i18n/resolveDeviceAppLocale";

describe("resolveDeviceAppLocale", () => {
  it("picks the first supported locale from the ordered preference list", () => {
    expect(resolveDeviceAppLocale(["zh", "de", "en"])).toBe("de");
    expect(resolveDeviceAppLocale(["fr"])).toBe("fr");
    expect(resolveDeviceAppLocale(["ru", "en"])).toBe("ru");
  });

  it("prefers a supported secondary over an unsupported primary (even RU-cluster)", () => {
    // uk is RU-cluster, but en is supported → en wins (rule 1 before 2.1).
    expect(resolveDeviceAppLocale(["uk", "en"])).toBe("en");
    expect(resolveDeviceAppLocale(["kk", "nl"])).toBe("nl");
  });

  it("maps East-Slavic / Central-Asian cluster to Russian when no app locale matches", () => {
    expect(resolveDeviceAppLocale(["uk"])).toBe("ru");
    expect(resolveDeviceAppLocale(["be"])).toBe("ru");
    expect(resolveDeviceAppLocale(["kk"])).toBe("ru");
    expect(resolveDeviceAppLocale(["ky"])).toBe("ru");
    expect(resolveDeviceAppLocale(["uz"])).toBe("ru");
    expect(resolveDeviceAppLocale(["tg"])).toBe("ru");
    expect(resolveDeviceAppLocale(["zh", "uk"])).toBe("ru");
  });

  it("falls back to English for other unsupported languages", () => {
    expect(resolveDeviceAppLocale(["cs"])).toBe("en");
    expect(resolveDeviceAppLocale(["hi"])).toBe("en");
    expect(resolveDeviceAppLocale(["vi"])).toBe("en");
    expect(resolveDeviceAppLocale(["zh", "ja"])).toBe("en");
    expect(resolveDeviceAppLocale([])).toBe("en");
  });
});
