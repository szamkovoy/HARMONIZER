import { describe, expect, it } from "vitest";

import { findExistingPlanningRowMatch, dedupePlanningMarkersByIdentity } from "./dialogBrainPersistence";

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

  it("matches the same action across conversations by identity, not only display_order", () => {
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

    expect(match?.id).toBe("row-1");
  });

  it("dedupes planning markers that describe the same action in different words", () => {
    const deduped = dedupePlanningMarkersByIdentity([
      {
        desc: "Studio di inglese per un'ora",
        time: null,
        timeNorm: null,
        recommendation: null,
        displayOrder: 1,
        cells: [],
        snippets: [],
      },
      {
        desc: "Vorrei studiare l'inglese per un'ora",
        time: null,
        timeNorm: null,
        recommendation: "Breve nota",
        displayOrder: 2,
        cells: [{ sphere: 3, chakra: 3 }],
        snippets: ["Vorrei studiare l'inglese per un'ora"],
      },
    ] as never);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.desc).toBe("Vorrei studiare l'inglese per un'ora");
    expect(deduped[0]?.recommendation).toBe("Breve nota");
    expect(deduped[0]?.cells).toEqual([{ sphere: 3, chakra: 3 }]);
  });

  it("collapses same display_order cake refinements into one recommended action", () => {
    const deduped = dedupePlanningMarkersByIdentity([
      {
        desc: "Кекс поесть",
        time: null,
        timeNorm: null,
        recommendation: null,
        displayOrder: 1,
        cells: [],
        snippets: [],
      },
      {
        desc: "Кекс и вино",
        time: null,
        timeNorm: null,
        recommendation: "Сделайте это ритуалом: налейте вино в красивый бокал.",
        displayOrder: 1,
        cells: [],
        snippets: [],
      },
    ] as never);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.desc).toBe("Кекс и вино");
    expect(deduped[0]?.recommendation).toContain("ритуалом");
  });
});
