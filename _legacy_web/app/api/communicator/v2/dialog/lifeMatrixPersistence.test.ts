import { describe, expect, it } from "vitest";

import { expireStalePlannedEvents, loadDuePlannedEvents } from "./lifeMatrixPersistence";

type QueryRecorder = {
  ltColumn: string | null;
  gteColumn: string | null;
  ltValue: string | null;
  gteValue: string | null;
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
                      return Promise.resolve({ data: [], error: null });
                    },
                    lte(_column: string, _value: string) {
                      return {
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
  it("expires planned rows by expected_at, not by planned_at", async () => {
    const recorder: QueryRecorder = { ltColumn: null, gteColumn: null, ltValue: null, gteValue: null };

    await expireStalePlannedEvents(
      createMockSupabase(recorder) as never,
      "user-1",
      "2026-05-25T12:00:00.000Z",
    );

    expect(recorder.ltColumn).toBe("expected_at");
    expect(recorder.ltValue).toBe("2026-05-24T00:00:00.000Z");
  });

  it("loads due rows using the expected_at summary window", async () => {
    const recorder: QueryRecorder = { ltColumn: null, gteColumn: null, ltValue: null, gteValue: null };

    await loadDuePlannedEvents(
      createMockSupabase(recorder) as never,
      "user-1",
      "2026-05-25T12:00:00.000Z",
    );

    expect(recorder.gteColumn).toBe("expected_at");
    expect(recorder.gteValue).toBe("2026-05-24T00:00:00.000Z");
  });

  it("collapses semantic duplicates when loading due planned rows", async () => {
    const recorder: QueryRecorder = { ltColumn: null, gteColumn: null, ltValue: null, gteValue: null };
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
