import { describe, expect, it } from "vitest";

import { findExistingPlanningRowMatch } from "./dialogBrainPersistence";

describe("dialogBrainPersistence", () => {
  it("falls back to same-conversation display_order matching in add-flow", () => {
    const existing = [
      {
        id: "row-1",
        conversation_id: "conv-1",
        description: "Corsa di 3 km",
        status: "planned",
        display_order: 8,
      },
    ] as never[];

    const match = findExistingPlanningRowMatch({
      existing: existing as never,
      desc: "Correre 3 km",
      conversationId: "conv-1",
      displayOrder: 8,
      appendToExisting: true,
    });

    expect(match?.id).toBe("row-1");
  });

  it("updates the prior add-flow slot when the model bumps display_order by one", () => {
    const existing = [
      {
        id: "row-1",
        conversation_id: "conv-1",
        description: "Corsa di 3 km",
        status: "planned",
        display_order: 8,
      },
    ] as never[];

    const match = findExistingPlanningRowMatch({
      existing: existing as never,
      desc: "Correre 3 km",
      conversationId: "conv-1",
      displayOrder: 9,
      appendToExisting: true,
      markerBatchSize: 1,
    });

    expect(match?.id).toBe("row-1");
  });

  it("does not cross-match another conversation only by display_order", () => {
    const existing = [
      {
        id: "row-1",
        conversation_id: "conv-other",
        description: "Corsa di 3 km",
        status: "planned",
        display_order: 8,
      },
    ] as never[];

    const match = findExistingPlanningRowMatch({
      existing: existing as never,
      desc: "Correre 3 km",
      conversationId: "conv-1",
      displayOrder: 8,
      appendToExisting: true,
    });

    expect(match).toBeUndefined();
  });
});
