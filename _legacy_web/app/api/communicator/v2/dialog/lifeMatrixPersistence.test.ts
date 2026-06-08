import { describe, expect, it } from "vitest";

import { expireStalePlannedEvents, loadDuePlannedEvents, upsertConversationSummary } from "./lifeMatrixPersistence";

type QueryRecorder = {
  ltColumn: string | null;
  gteColumn: string | null;
  lteColumn: string | null;
  ltValue: string | null;
  gteValue: string | null;
  lteValue: string | null;
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
                    lte(column: string, value: string) {
                      recorder.lteColumn = column;
                      recorder.lteValue = value;
                      return {
                        order() {
                          return Promise.resolve({ data: rows, error: null });
                        },
                        gte(column: string, value: string) {
                          recorder.gteColumn = column;
                          recorder.gteValue = value;
                          return {
                            order() {
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
}

describe("lifeMatrixPersistence planned event windows", () => {
  it("does not auto-expire old planned rows", async () => {
    const recorder: QueryRecorder = {
      ltColumn: null,
      gteColumn: null,
      lteColumn: null,
      ltValue: null,
      gteValue: null,
      lteValue: null,
    };

    await expireStalePlannedEvents(
      createMockSupabase(recorder) as never,
      "user-1",
      "2026-05-25T12:00:00.000Z",
    );

    expect(recorder.ltColumn).toBeNull();
    expect(recorder.ltValue).toBeNull();
  });

  it("loads due rows without a lower summary window", async () => {
    const recorder: QueryRecorder = {
      ltColumn: null,
      gteColumn: null,
      lteColumn: null,
      ltValue: null,
      gteValue: null,
      lteValue: null,
    };

    await loadDuePlannedEvents(
      createMockSupabase(recorder) as never,
      "user-1",
      "2026-05-25T12:00:00.000Z",
    );

    expect(recorder.lteColumn).toBe("expected_at");
    expect(recorder.gteColumn).toBeNull();
    expect(recorder.gteValue).toBeNull();
  });

  it("can cap due rows by a simulated dialog cutoff without applying expiry", async () => {
    const recorder: QueryRecorder = {
      ltColumn: null,
      gteColumn: null,
      lteColumn: null,
      ltValue: null,
      gteValue: null,
      lteValue: null,
    };

    await loadDuePlannedEvents(
      createMockSupabase(recorder) as never,
      "user-1",
      "2026-05-25T16:30:00.000Z",
      "2026-05-25T09:00:00.000Z",
    );

    expect(recorder.lteColumn).toBe("expected_at");
    expect(recorder.lteValue).toBe("2026-05-25T09:00:00.000Z");
    expect(recorder.gteValue).toBeNull();
  });

  it("collapses semantic duplicates when loading due planned rows", async () => {
    const recorder: QueryRecorder = {
      ltColumn: null,
      gteColumn: null,
      lteColumn: null,
      ltValue: null,
      gteValue: null,
      lteValue: null,
    };
    const rows = [
      {
        id: "event-1",
        description: "Поход в театр вечером",
        expected_at: "2026-05-26T17:00:00+00:00",
        planned_at: "2026-05-26T14:08:31.017+00:00",
        planned_local_date: "2026-05-26",
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
        expected_at: "2026-05-26T17:00:00+00:00",
        planned_at: "2026-05-26T14:08:35.366+00:00",
        planned_local_date: "2026-05-26",
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
      "2026-05-26T18:00:00.000Z",
    );

    expect(due).toHaveLength(1);
    expect(due[0]?.description).toBe("Поход в театр вечером");
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
