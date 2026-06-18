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
import { loadPracticeCatalog } from "./catalog";

vi.mock("@/services/runtimeDiagnostics", () => ({
  logRuntimeEvent: vi.fn(),
}));

vi.mock("@/services/supabase", () => ({
  getSupabase: vi.fn(() => null),
}));

/** Дождаться фонового `void (async () => { await withTimeout(...) })()` после `loadPracticeCatalog`. */
function yieldToDeferredCatalogWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

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

describe("loadPracticeCatalog", () => {
  it("returns meditation and breath immediately when yoga is deferred", async () => {
    let resolveYoga!: (value: PracticeSummary[]) => void;
    const yogaPromise = new Promise<PracticeSummary[]>((resolve) => {
      resolveYoga = resolve;
    });
    const onLateYogaPractices = vi.fn();

    const catalog = await loadPracticeCatalog(
      { onLateYogaPractices },
      { loadYogaPractices: () => yogaPromise },
    );

    expect(catalog.meditation).toHaveLength(1);
    expect(catalog.breath).toHaveLength(7);
    expect(catalog.yoga).toEqual([]);
    expect(onLateYogaPractices).not.toHaveBeenCalled();

    resolveYoga([YOGA_PRACTICE]);
    await yieldToDeferredCatalogWork();

    expect(onLateYogaPractices).toHaveBeenCalledWith({ practices: [YOGA_PRACTICE], state: "ready" });
  });

  it("reports a late yoga error when the loader rejects", async () => {
    const onLateYogaPractices = vi.fn();
    await loadPracticeCatalog(
      { onLateYogaPractices },
      {
        loadYogaPractices: async () => {
          throw new Error("network");
        },
      },
    );
    await yieldToDeferredCatalogWork();
    expect(onLateYogaPractices).toHaveBeenCalledWith({
      practices: [],
      state: "error",
      errorMessage: "network",
    });
  });

  it("reports timeout first and then updates when yoga resolves", async () => {
    vi.useFakeTimers();
    try {
      let resolveYoga!: (value: PracticeSummary[]) => void;
      const yogaPromise = new Promise<PracticeSummary[]>((resolve) => {
        resolveYoga = resolve;
      });
      const onLateYogaPractices = vi.fn();

      await loadPracticeCatalog({ onLateYogaPractices }, { loadYogaPractices: () => yogaPromise });

      expect(onLateYogaPractices).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(onLateYogaPractices).toHaveBeenCalledWith({ practices: [], state: "timeout" });

      resolveYoga([YOGA_PRACTICE]);
      vi.useRealTimers();
      await yieldToDeferredCatalogWork();

      expect(onLateYogaPractices).toHaveBeenLastCalledWith({ practices: [YOGA_PRACTICE], state: "ready" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for yoga when no late callback is provided", async () => {
    const catalog = await loadPracticeCatalog(undefined, {
      loadYogaPractices: async () => [YOGA_PRACTICE],
    });

    expect(catalog.meditation).toHaveLength(1);
    expect(catalog.breath).toHaveLength(7);
    expect(catalog.yoga).toEqual([YOGA_PRACTICE]);
  });
});
