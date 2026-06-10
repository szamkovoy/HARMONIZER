import { describe, expect, it } from "vitest";

import {
  collectSummaryEventsFromExportMessages,
  mergeExportMessages,
  reconcileExportPlanningPersistence,
} from "./dialogExportMerge";

describe("mergeExportMessages", () => {
  it("merges server planning meta onto local assistant turn when server content is empty", () => {
    const merged = mergeExportMessages({
      localMessages: [
        { id: "local-1", role: "assistant", content: "Доброе утро", meta: {} },
        { id: "local-2", role: "user", content: "Через полчаса вебинар", meta: {} },
        {
          id: "local-3",
          role: "assistant",
          content: "Финальная рекомендация",
          meta: {},
        },
      ],
      syncedMessages: [
        { id: "srv-1", role: "assistant", content: "", meta: { planningPersistence: { inserted: [], summarized: [], skipped: [] } } },
        { id: "srv-2", role: "user", content: "", meta: {} },
        {
          id: "srv-3",
          role: "assistant",
          content: "",
          meta: {
            planningPersistence: {
              inserted: [{ id: "evt-1", description: "вебинар" }],
              summarized: [],
              skipped: [],
            },
          },
          rawMeta: { planning_persistence: { inserted: [{ id: "evt-1" }], summarized: [], skipped: [] } },
        },
      ],
    });

    expect(merged).toHaveLength(3);
    expect(merged[2]?.meta?.planningPersistence?.inserted).toHaveLength(1);
    expect(merged[2]?.rawMeta?.planning_persistence).toBeTruthy();
  });
});

describe("collectSummaryEventsFromExportMessages", () => {
  it("collects per-turn matrix outcomes from server planning_persistence rawMeta", () => {
    const { applied, closedWithoutMatrix } = collectSummaryEventsFromExportMessages([
      {
        id: "msg-1",
        role: "assistant",
        rawMeta: {
          planning_persistence: {
            inserted: [],
            summarized: [
              {
                id: "evt-1",
                description: "Прогулка в парке",
                outcome_text: "Хорошая прогулка",
                outcome_cells: [{ sphere: 1, chakra: 2, weight: 0.8 }],
                applied_to_matrix: true,
                summarized_at: "2026-06-10T15:00:00.000Z",
              },
            ],
            skipped: [],
          },
        },
      },
      {
        id: "msg-2",
        role: "assistant",
        rawMeta: {
          planning_persistence: {
            inserted: [],
            summarized: [
              {
                id: "evt-2",
                description: "Саженцы",
                outcome_text: "Не поехал",
                outcome_cells: [],
                applied_to_matrix: false,
                summarized_at: "2026-06-10T15:01:00.000Z",
              },
            ],
            skipped: [],
          },
        },
      },
    ], { requireServerPersistedMeta: true });
    expect(applied).toHaveLength(1);
    expect(applied[0]?.source_message_id).toBe("msg-1");
    expect(closedWithoutMatrix).toHaveLength(1);
  });
});

describe("reconcileExportPlanningPersistence", () => {
  it("fills planning_persistence on last assistant row from dialog_state_after when missing", () => {
    const rows = [
      {
        role: "assistant",
        meta: { planning_persistence: null as { inserted: unknown[]; summarized: unknown[]; skipped: unknown[] } | null },
      },
    ];
    reconcileExportPlanningPersistence(rows, {
      planning_created_in_this_conversation: [{ id: "evt-1", description: "вебинар" }],
    });
    expect(rows[0]?.meta.planning_persistence?.inserted).toHaveLength(1);
  });
});
