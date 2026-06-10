import { describe, expect, it } from "vitest";

import {
  expireStalePlannedEvents,
  loadDuePlannedEvents,
  loadPlannedEventsUpToLocalDate,
  upsertConversationSummary,
} from "./lifeMatrixPersistence";

type QueryRecorder = {
  ltColumn: string | null;
  ltValue: string | null;
  lteColumn: string | null;
  lteValue: string | null;
  orderColumns: string[];
};

function createMockSupabase(recorder: QueryRecorder, rows: unknown[] = []) {
  return {
    from(table: string) {
      expect(table).toBe("planned_events");
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    lt(column: string, value: string) {
                      recorder.ltColumn = column;
                      recorder.ltValue = value;
                      return {
                        order(column: string) {
                          recorder.orderColumns.push(column);
                          return {
                            order(nextColumn: string) {
                              recorder.orderColumns.push(nextColumn);
                              return {
                                order(lastColumn: string) {
                                  recorder.orderColumns.push(lastColumn);
                                  return Promise.resolve({ data: rows, error: null });
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                    lte(column: string, value: string) {
                      recorder.lteColumn = column;
                      recorder.lteValue = value;
                      return {
                        order(column: string) {
                          recorder.orderColumns.push(column);
                          return {
                            order(nextColumn: string) {
                              recorder.orderColumns.push(nextColumn);
                              return {
                                order(lastColumn: string) {
                                  recorder.orderColumns.push(lastColumn);
                                  return Promise.resolve({ data: rows, error: null });
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("lifeMatrixPersistence planned event windows", () => {
  it("does not auto-expire old planned rows", async () => {
    const recorder: QueryRecorder = {
      ltColumn: null,
      ltValue: null,
      lteColumn: null,
      lteValue: null,
      orderColumns: [],
    };

    await expireStalePlannedEvents(
      createMockSupabase(recorder) as never,
      "user-1",
      "2026-05-25T12:00:00.000Z",
    );

    expect(recorder.ltColumn).toBeNull();
    expect(recorder.ltValue).toBeNull();
  });

  it("loads only unfinished rows from the latest prior local day", async () => {
    const recorder: QueryRecorder = {
      ltColumn: null,
      ltValue: null,
      lteColumn: null,
      lteValue: null,
      orderColumns: [],
    };

    const due = await loadDuePlannedEvents(
      createMockSupabase(recorder, [
        {
          id: "yesterday-1",
          description: "Встреча с клиентом",
          expected_at: "2026-05-24T17:00:00+00:00",
          planned_at: "2026-05-24T08:00:00+00:00",
          planned_local_date: "2026-05-24",
          status: "planned",
          time_phrase_raw: null,
          time_resolution: "fallback_default",
          context_snippets: [],
          cells: [],
          outcome_cells: null,
          outcome_text: null,
        },
        {
          id: "older-1",
          description: "Сходить в парк",
          expected_at: "2026-05-23T17:00:00+00:00",
          planned_at: "2026-05-23T08:00:00+00:00",
          planned_local_date: "2026-05-23",
          status: "planned",
          time_phrase_raw: null,
          time_resolution: "fallback_default",
          context_snippets: [],
          cells: [],
          outcome_cells: null,
          outcome_text: null,
        },
      ]) as never,
      "user-1",
      "2026-05-25",
    );

    expect(recorder.ltColumn).toBe("planned_local_date");
    expect(recorder.ltValue).toBe("2026-05-25");
    expect(recorder.orderColumns).toEqual(["planned_local_date", "display_order", "planned_at"]);
    expect(due).toHaveLength(1);
    expect(due[0]?.planned_local_date).toBe("2026-05-24");
  });

  it("collapses semantic duplicates when loading unfinished rows", async () => {
    const recorder: QueryRecorder = {
      ltColumn: null,
      ltValue: null,
      lteColumn: null,
      lteValue: null,
      orderColumns: [],
    };
    const rows = [
      {
        id: "event-1",
        description: "Поход в театр вечером",
        expected_at: "2026-05-24T17:00:00+00:00",
        planned_at: "2026-05-24T14:08:31.017+00:00",
        planned_local_date: "2026-05-24",
        status: "planned",
        time_phrase_raw: "вечером",
        time_resolution: "daypart_default",
        context_snippets: ["Вечером пойду в театр"],
        cells: [],
        outcome_cells: null,
        outcome_text: null,
      },
      {
        id: "event-2",
        description: "Поход в театр",
        expected_at: "2026-05-24T17:00:00+00:00",
        planned_at: "2026-05-24T14:08:35.366+00:00",
        planned_local_date: "2026-05-24",
        status: "planned",
        time_phrase_raw: "вечером",
        time_resolution: "daypart_default",
        context_snippets: ["Может быть, в театр пойду"],
        cells: [],
        outcome_cells: null,
        outcome_text: null,
      },
    ];

    const due = await loadDuePlannedEvents(
      createMockSupabase(recorder, rows) as never,
      "user-1",
      "2026-05-25",
    );

    expect(due).toHaveLength(1);
    expect(due[0]?.description).toBe("Поход в театр вечером");
  });

  it("loads overdue and requested-day rows for day-summary recovery", async () => {
    const recorder: QueryRecorder = {
      ltColumn: null,
      ltValue: null,
      lteColumn: null,
      lteValue: null,
      orderColumns: [],
    };

    const due = await loadPlannedEventsUpToLocalDate(
      createMockSupabase(recorder, [
        {
          id: "yesterday-1",
          description: "Вчерашнее дело",
          expected_at: "2026-05-24T17:00:00+00:00",
          planned_at: "2026-05-24T08:00:00+00:00",
          planned_local_date: "2026-05-24",
          status: "planned",
          time_phrase_raw: null,
          time_resolution: "fallback_default",
          context_snippets: [],
          cells: [],
          outcome_cells: null,
          outcome_text: null,
        },
        {
          id: "today-1",
          description: "Сегодняшнее дело",
          expected_at: "2026-05-25T17:00:00+00:00",
          planned_at: "2026-05-25T08:00:00+00:00",
          planned_local_date: "2026-05-25",
          status: "planned",
          time_phrase_raw: null,
          time_resolution: "fallback_default",
          context_snippets: [],
          cells: [],
          outcome_cells: null,
          outcome_text: null,
        },
      ]) as never,
      "user-1",
      "2026-05-25",
    );

    expect(recorder.lteColumn).toBe("planned_local_date");
    expect(recorder.lteValue).toBe("2026-05-25");
    expect(recorder.orderColumns).toEqual(["planned_local_date", "display_order", "planned_at"]);
    expect(due.map((row) => row.id)).toEqual(["yesterday-1", "today-1"]);
  });
});

describe("upsertConversationSummary", () => {
  it("upserts by conversation_id to avoid duplicate-key crashes on later turns", async () => {
    const calls: Array<{ values: Record<string, unknown>; options: Record<string, unknown> | undefined }> = [];
    const db = {
      from(table: string) {
        expect(table).toBe("conversation_summaries");
        return {
          upsert(values: Record<string, unknown>, options?: Record<string, unknown>) {
            calls.push({ values, options });
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    await upsertConversationSummary(db as never, {
      userId: "user-1",
      conversationId: "conv-1",
      summaryText: "ignored",
      branch: "planning",
      phaseTime: "morning",
      relatedEventIds: ["event-1"],
      matrixCells: [{ sphere: 3, chakra: 5, weight: 1 }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({ onConflict: "conversation_id" });
    expect(calls[0]?.values.summary_text).toBe("[planning:morning]");
  });
});
