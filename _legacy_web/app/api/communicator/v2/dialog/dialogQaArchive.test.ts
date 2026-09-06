import { describe, expect, it } from "vitest";
import {
  buildDailyDialogArchiveTurns,
  compactPlanningPersistence,
  resolveDailyDialogArchiveOutcome,
} from "@legacy/app/api/communicator/v2/dialog/dialogQaArchive";

describe("resolveDailyDialogArchiveOutcome", () => {
  it("marks a normal shouldClose as completed", () => {
    expect(resolveDailyDialogArchiveOutcome({ shouldClose: true })).toBe("completed");
  });

  it("marks practice card close as practice_handoff", () => {
    expect(resolveDailyDialogArchiveOutcome({ shouldClose: true, practicePicked: true })).toBe(
      "practice_handoff",
    );
  });

  it("prefers stream error over close", () => {
    expect(
      resolveDailyDialogArchiveOutcome({ shouldClose: true, streamError: true }),
    ).toBe("error");
  });

  it("marks a missing assistant reply as interrupted", () => {
    expect(resolveDailyDialogArchiveOutcome({ interrupted: true })).toBe("interrupted");
  });

  it("stays open while the dialog continues", () => {
    expect(resolveDailyDialogArchiveOutcome({})).toBe("open");
  });
});

describe("compactPlanningPersistence", () => {
  it("keeps ids and short descriptions only", () => {
    expect(
      compactPlanningPersistence({
        inserted: [
          { id: "e1", action: "inserted", description: "Уборка квартиры", display_order: 1, cells: { noisy: true } },
        ],
        updated: [],
      }),
    ).toEqual({
      inserted: [{ id: "e1", action: "inserted", description: "Уборка квартиры", display_order: 1 }],
    });
  });

  it("returns null when nothing was persisted", () => {
    expect(compactPlanningPersistence({ inserted: [], updated: [] })).toBeNull();
  });
});

describe("buildDailyDialogArchiveTurns", () => {
  it("omits empty user initiate and keeps assistant opening", () => {
    const turns = buildDailyDialogArchiveTurns({
      userMessage: "",
      assistantText: "Что важного сегодня?",
      branch: "planning",
      turnMode: "opening",
      at: "2026-09-06T09:00:00.000Z",
    });
    expect(turns).toEqual([
      {
        role: "assistant",
        text: "Что важного сегодня?",
        at: "2026-09-06T09:00:00.000Z",
        branch: "planning",
        turnMode: "opening",
      },
    ]);
  });

  it("pairs user and assistant with guard + persistence on the assistant turn", () => {
    const turns = buildDailyDialogArchiveTurns({
      userMessage: "Больше планов нет",
      assistantText: "1. Прогулка",
      branch: "planning",
      turnMode: "inquiry",
      shouldClose: true,
      guards: ["planning_stop_valve"],
      planningPersistence: { inserted: [{ id: "e1", description: "Прогулка" }] },
      at: "2026-09-06T09:01:00.000Z",
    });
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", text: "Больше планов нет" });
    expect(turns[1]).toMatchObject({
      role: "assistant",
      shouldClose: true,
      guards: ["planning_stop_valve"],
      planningPersistence: { inserted: [{ id: "e1", description: "Прогулка" }] },
    });
  });
});
