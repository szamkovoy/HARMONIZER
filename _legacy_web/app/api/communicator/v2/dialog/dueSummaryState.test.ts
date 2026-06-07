import { describe, expect, it } from "vitest";

import {
  readDueSummaryState,
  resolveDueSummaryTurn,
  selectDueEventsForTurn,
} from "./dueSummaryState";
import type { PlannedEventRow } from "./lifeMatrixPersistence";

function plannedEvent(id: string): PlannedEventRow {
  return {
    id,
    description: `event-${id}`,
    expected_at: "2026-06-03T09:00:00Z",
    planned_at: "2026-06-02T09:00:00Z",
    planned_local_date: "2026-06-02",
    status: "planned",
    time_phrase_raw: null,
    time_resolution: "explicit",
    context_snippets: [],
    cells: [],
    outcome_cells: null,
    outcome_text: null,
  };
}

describe("dueSummaryState", () => {
  it("reuses prompted ids from trigger_meta when they are still due", () => {
    const dueEvents = [plannedEvent("a"), plannedEvent("b"), plannedEvent("c")];
    const state = readDueSummaryState({
      due_summary_state: {
        prompted_event_ids: ["b", "a"],
        reminder_count: 1,
        last_prompted_at: "2026-06-03T10:00:00Z",
      },
    }, dueEvents);

    expect(selectDueEventsForTurn(dueEvents, state).map((event) => event.id)).toEqual(["b", "a"]);
  });

  it("limits a fresh due set to the first three events", () => {
    const dueEvents = [plannedEvent("a"), plannedEvent("b"), plannedEvent("c"), plannedEvent("d")];
    expect(selectDueEventsForTurn(dueEvents, null).map((event) => event.id)).toEqual(["a", "b", "c"]);
  });

  it("stores prompted ids on initiate without deleting anything", () => {
    const result = resolveDueSummaryTurn({
      existingState: null,
      selectedDueEvents: [plannedEvent("a"), plannedEvent("b")],
      answeredEventIds: [],
      isInitiate: true,
      summarizingActive: true,
      nowIso: "2026-06-03T12:00:00Z",
    });

    expect(result.nextState).toEqual({
      prompted_event_ids: ["a", "b"],
      reminder_count: 0,
      last_prompted_at: "2026-06-03T12:00:00Z",
    });
    expect(result.deleteEventIds).toEqual([]);
  });

  it("reminds once after the first ignored reply", () => {
    const result = resolveDueSummaryTurn({
      existingState: {
        prompted_event_ids: ["a", "b"],
        reminder_count: 0,
        last_prompted_at: "2026-06-03T12:00:00Z",
      },
      selectedDueEvents: [plannedEvent("a"), plannedEvent("b")],
      answeredEventIds: [],
      isInitiate: false,
      summarizingActive: true,
      nowIso: "2026-06-03T12:05:00Z",
    });

    expect(result.nextState?.reminder_count).toBe(1);
    expect(result.deleteEventIds).toEqual([]);
  });

  it("deletes prompted due events after a second ignore", () => {
    const result = resolveDueSummaryTurn({
      existingState: {
        prompted_event_ids: ["a", "b"],
        reminder_count: 1,
        last_prompted_at: "2026-06-03T12:05:00Z",
      },
      selectedDueEvents: [plannedEvent("a"), plannedEvent("b")],
      answeredEventIds: [],
      isInitiate: false,
      summarizingActive: true,
      nowIso: "2026-06-03T12:10:00Z",
    });

    expect(result.nextState).toBeNull();
    expect(result.deleteEventIds).toEqual(["a", "b"]);
  });

  it("keeps the unanswered remainder active after a partial answer", () => {
    const result = resolveDueSummaryTurn({
      existingState: {
        prompted_event_ids: ["a", "b"],
        reminder_count: 0,
        last_prompted_at: "2026-06-03T12:00:00Z",
      },
      selectedDueEvents: [plannedEvent("a"), plannedEvent("b")],
      answeredEventIds: ["b"],
      isInitiate: false,
      summarizingActive: true,
      nowIso: "2026-06-03T12:10:00Z",
    });

    expect(result.nextState).toEqual({
      prompted_event_ids: ["a"],
      reminder_count: 0,
      last_prompted_at: "2026-06-03T12:10:00Z",
    });
    expect(result.deleteEventIds).toEqual([]);
  });
});
