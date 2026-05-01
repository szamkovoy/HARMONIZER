import { describe, expect, it, vi } from "vitest";
import { clearScenarioMemoryCache, getScenario, listScenarios } from "./scenarios";

function mockScenarioDb(rows: Array<Record<string, unknown>>) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((_key: string, value: unknown) => {
      if (_key === "id") chain.currentId = String(value);
      if (_key === "scenario_type") chain.currentType = String(value);
      return chain;
    }),
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: rows.find((row) => row.id === chain.currentId && row.is_active === true) ?? null,
      error: null,
    })),
    then: (resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => void) => {
      const filtered = rows
        .filter((row) => row.is_active === true)
        .filter((row) => !chain.currentType || row.scenario_type === chain.currentType);
      return Promise.resolve({ data: filtered, error: null }).then(resolve);
    },
    currentId: "",
    currentType: "",
  };

  return {
    from: vi.fn(() => chain),
    chain,
  };
}

describe("scenario helpers", () => {
  it("returns active scenario by id and caches it", async () => {
    clearScenarioMemoryCache();
    const db = mockScenarioDb([
      {
        id: "morning_recommendation",
        scenario_type: "monologue",
        display_name: { ru: "Утренняя рекомендация" },
        is_active: true,
        cache_strategy: "per_user_per_day",
      },
    ]);

    const first = await getScenario("morning_recommendation", db as never);
    const second = await getScenario("morning_recommendation", db as never);

    expect(first?.scenario_type).toBe("monologue");
    expect(first?.cache_strategy).toBe("per_user_per_day");
    expect(second).toBe(first);
    expect(db.chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns null for unknown or inactive scenarios", async () => {
    clearScenarioMemoryCache();
    const db = mockScenarioDb([{ id: "inactive", scenario_type: "dialogue", is_active: false }]);

    await expect(getScenario("inactive", db as never)).resolves.toBeNull();
    await expect(getScenario("missing", db as never)).resolves.toBeNull();
  });

  it("lists active scenarios by type", async () => {
    clearScenarioMemoryCache();
    const db = mockScenarioDb([
      { id: "daily_dialog", scenario_type: "dialogue", is_active: true },
      { id: "morning_recommendation", scenario_type: "monologue", is_active: true },
    ]);

    const scenarios = await listScenarios("dialogue", db as never);
    expect(scenarios).toEqual([{ id: "daily_dialog", scenario_type: "dialogue", is_active: true }]);
  });
});
