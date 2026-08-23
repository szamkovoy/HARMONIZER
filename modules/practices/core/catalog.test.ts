import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/breath", () => ({
  BREATH_PRACTICES: [
    { id: "coherent", indicatorKind: "coherence", channelMode: "guided", normalBaseBeats: 4 },
    { id: "nadi-shodhana", indicatorKind: "alternate", channelMode: "guided", normalBaseBeats: 4 },
    { id: "surya-bhedana", indicatorKind: "solar", channelMode: "guided", normalBaseBeats: 4 },
    { id: "chandra-bhedana", indicatorKind: "lunar", channelMode: "guided", normalBaseBeats: 4 },
    { id: "square", indicatorKind: "box", channelMode: "guided", normalBaseBeats: 4 },
    { id: "triangle-up", indicatorKind: "triangle-up", channelMode: "guided", normalBaseBeats: 4 },
    { id: "triangle-down", indicatorKind: "triangle-down", channelMode: "guided", normalBaseBeats: 4 },
  ],
  DEFAULT_CHAKRA: 6,
  isChakra: (value: unknown) => typeof value === "number" && value >= 1 && value <= 7,
}));

vi.mock("@/modules/breath/i18n/coherence", () => ({
  getCoherenceBreathStrings: () => ({
    practiceName: {
      coherent: "Coherent",
      "nadi-shodhana": "Nadi",
      "surya-bhedana": "Surya",
      "chandra-bhedana": "Chandra",
      square: "Square",
      "triangle-up": "Triangle Up",
      "triangle-down": "Triangle Down",
    },
    practiceSanskritName: {
      coherent: "Coherent",
      "nadi-shodhana": "Nadi",
      "surya-bhedana": "Surya",
      "chandra-bhedana": "Chandra",
      square: "Square",
      "triangle-up": "Triangle Up",
      "triangle-down": "Triangle Down",
    },
  }),
}));

import type { PracticeSummary } from "./types";
import {
  formatPracticeCatalogError,
  getPracticeCatalog,
  getYogaCatalogSnapshot,
  loadPracticeCatalog,
  resolveYogaPracticeTitle,
} from "./catalog";

vi.mock("@/services/runtimeDiagnostics", () => ({
  logRuntimeEvent: vi.fn(),
}));

const YOGA_PRACTICE: PracticeSummary = {
  id: "yoga:test-1",
  slug: "test-1",
  kind: "yoga",
  title: "Тестовая асана",
  durationPolicy: "fixed",
  chakraIds: [4],
  source: "supabase",
  launch: {
    kind: "yoga",
    route: "/asana-practice",
    practiceId: "yoga:test-1",
  },
};

describe("getPracticeCatalog", () => {
  it("returns static meditations + breath + snapshot yoga synchronously", () => {
    const catalog = getPracticeCatalog("ru");
    // 2 static meditations (Flash + Calm), 7 breath practices, snapshot yoga (187 in prod).
    expect(catalog.meditation).toHaveLength(2);
    expect(catalog.breath).toHaveLength(7);
    expect(catalog.yoga.length).toBeGreaterThan(0);
    expect(catalog.yoga.every((p) => p.kind === "yoga")).toBe(true);
  });

  it("memoizes the yoga snapshot per locale", () => {
    const a = getYogaCatalogSnapshot("ru");
    const b = getYogaCatalogSnapshot("ru");
    expect(b).toBe(a);
  });
});

describe("loadPracticeCatalog (backward-compat wrapper)", () => {
  it("returns the snapshot catalog when no deps are provided", async () => {
    const catalog = await loadPracticeCatalog({ locale: "ru" });
    expect(catalog.meditation).toHaveLength(2);
    expect(catalog.breath).toHaveLength(7);
    expect(catalog.yoga.length).toBeGreaterThan(0);
  });

  it("uses an injected loader when deps are provided", async () => {
    const catalog = await loadPracticeCatalog(undefined, {
      loadYogaPractices: async () => [YOGA_PRACTICE],
    });
    expect(catalog.meditation).toHaveLength(2);
    expect(catalog.breath).toHaveLength(7);
    expect(catalog.yoga).toEqual([YOGA_PRACTICE]);
  });

  it("ignores the legacy onLateYogaPractices / initialYoga options (yoga is instant)", async () => {
    const onLateYogaPractices = vi.fn();
    const catalog = await loadPracticeCatalog(
      { initialYoga: [YOGA_PRACTICE], onLateYogaPractices },
      { loadYogaPractices: async () => [YOGA_PRACTICE] },
    );
    expect(catalog.yoga).toEqual([YOGA_PRACTICE]);
    expect(onLateYogaPractices).not.toHaveBeenCalled();
  });
});

describe("formatPracticeCatalogError", () => {
  it("formats object-shaped catalog errors for the UI", () => {
    expect(
      formatPracticeCatalogError({
        message: "Failed to fetch",
        details: "connection pool timeout",
        code: "57014",
      }),
    ).toBe("Failed to fetch | connection pool timeout | 57014");
  });
});

describe("resolveYogaPracticeTitle", () => {
  it("normalizes imported yoga titles to the locale-specific practice prefix", () => {
    expect(resolveYogaPracticeTitle({ ru: "Пробуждение: 3_0819_и3" } as never, "fallback", "ru")).toBe(
      "Практика: 3_0819",
    );
    expect(resolveYogaPracticeTitle({ ru: "Пробуждение: 3_0819_и3" } as never, "fallback", "de")).toBe(
      "Übung: 3_0819",
    );
  });
});
