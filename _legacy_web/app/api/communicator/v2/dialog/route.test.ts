import { describe, expect, it } from "vitest";
import {
  isConversationExpired,
  lastAssistantDecisions,
  loadHistory,
  normalizeTurnHistory,
  todayLocalDate,
} from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";
import { shouldRetryForMissingSummaryMarker } from "./summaryRepair";

function createMockSupabase(messages: unknown[]) {
  const calls: Array<{ ascending: boolean; limit: number }> = [];

  return {
    calls,
    from: (table: string) => {
      expect(table).toBe("messages");
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: (_column: string, options: { ascending: boolean }) => ({
                limit: (limit: number) => {
                  calls.push({ ascending: options.ascending, limit });
                  return Promise.resolve({ data: messages, error: null });
                },
              }),
            }),
          }),
        }),
      };
    },
  };
}

describe("dialog history loading", () => {
  it("loads the last N messages and returns them in chronological order", async () => {
    const descendingLastMessages = Array.from({ length: 50 }, (_, index) => ({
      id: `msg_${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Message ${index}`,
      transcript: null,
      meta: null,
      created_at: new Date(2026, 0, 1, 0, 0, index).toISOString(),
    }))
      .reverse()
      .slice(0, 40);
    const supabase = createMockSupabase(descendingLastMessages);

    const history = await loadHistory(supabase as never, "user1", "conv1", 40);

    expect(supabase.calls).toEqual([{ ascending: false, limit: 40 }]);
    expect(history).toHaveLength(40);
    expect(history[0].id).toBe("msg_10");
    expect(history[39].id).toBe("msg_49");
  });

  it("returns all messages chronologically when the conversation is shorter than the limit", async () => {
    const supabase = createMockSupabase([
      { id: "2", role: "assistant", content: "Hello", transcript: null, meta: null, created_at: "2026-01-01T00:00:01Z" },
      { id: "1", role: "user", content: "Hi", transcript: null, meta: null, created_at: "2026-01-01T00:00:00Z" },
    ]);

    const history = await loadHistory(supabase as never, "user1", "conv1", 40);

    expect(history.map((message) => message.id)).toEqual(["1", "2"]);
  });

  it("returns an empty array for an empty conversation", async () => {
    const supabase = createMockSupabase([]);

    await expect(loadHistory(supabase as never, "user1", "conv1", 40)).resolves.toEqual([]);
  });
});

describe("dialog decision cache history helpers", () => {
  it("returns the latest assistant decisions, not the first ones", () => {
    const history = [
      { id: "1", role: "user", content: "msg 1", transcript: null, meta: {}, created_at: null },
      {
        id: "2",
        role: "assistant",
        content: "ans 1",
        transcript: null,
        meta: { orchestrator_decision: { next_phase: "phase_A" } },
        created_at: null,
      },
      { id: "3", role: "user", content: "msg 2", transcript: null, meta: {}, created_at: null },
      {
        id: "4",
        role: "assistant",
        content: "ans 2",
        transcript: null,
        meta: { orchestrator_decision: { next_phase: "phase_B" } },
        created_at: null,
      },
      { id: "5", role: "user", content: "msg 3", transcript: null, meta: {}, created_at: null },
      {
        id: "6",
        role: "assistant",
        content: "ans 3",
        transcript: null,
        meta: { orchestrator_decision: { next_phase: "phase_C" } },
        created_at: null,
      },
    ];

    const lastTwo = lastAssistantDecisions(history as never, 2);

    expect(lastTwo).toHaveLength(2);
    expect(lastTwo[0].next_phase).toBe("phase_B");
    expect(lastTwo[1].next_phase).toBe("phase_C");
  });
});

describe("dialog session lifecycle helpers", () => {
  it("uses user timezone to calculate local day", () => {
    const now = new Date("2026-05-01T21:30:00.000Z");

    expect(todayLocalDate("Europe/Moscow", now)).toBe("2026-05-02");
    expect(todayLocalDate("America/New_York", now)).toBe("2026-05-01");
  });

  it("expires conversations after two hours or local day change", () => {
    const now = new Date("2026-05-01T12:00:00.000Z");

    expect(
      isConversationExpired(
        {
          started_at: "2026-05-01T09:00:00.000Z",
          last_message_at: "2026-05-01T10:30:01.000Z",
        },
        "UTC",
        now,
      ),
    ).toBe(false);
    expect(
      isConversationExpired(
        {
          started_at: "2026-05-01T09:00:00.000Z",
          last_message_at: "2026-05-01T09:59:59.000Z",
        },
        "UTC",
        now,
      ),
    ).toBe(true);
    expect(
      isConversationExpired(
        {
          started_at: "2026-04-30T21:30:00.000Z",
          last_message_at: "2026-05-01T00:30:00.000Z",
        },
        "America/New_York",
        now,
      ),
    ).toBe(true);
  });
});

describe("normalizeTurnHistory", () => {
  it("preserves practice and turn mode meta needed by the orchestrator", () => {
    expect(
      normalizeTurnHistory([
        {
          role: "assistant",
          content: "Вот практика",
          meta: {
            turnMode: "final_recommendation",
            practicePicked: {
              id: "practice-1",
              kind: "breath",
            },
            debug: { ignored: true },
          },
        },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: "Вот практика",
        meta: {
          turn_mode: "final_recommendation",
          practicePicked: {
            id: "practice-1",
            kind: "breath",
          },
          practice_picked: {
            id: "practice-1",
            kind: "breath",
          },
        },
      },
    ]);
  });
});

describe("missing summary retry guard", () => {
  it("retries summary repair for final_without_practice when the single due event was answered", () => {
    expect(shouldRetryForMissingSummaryMarker({
      branches: ["summarizing"],
      summarizeEventsCount: 0,
      userMessage: "Встреча была непростая, возник конфликт интересов, договорились вернуться к переговорам позже.",
      dueEvents: [
        {
          id: "event-1",
          description: "Встреча с клиентом",
          expected_at: "2026-05-26T03:19:00+00:00",
          planned_at: "2026-05-26T05:40:40.244+00:00",
          planned_local_date: "2026-05-26",
          status: "planned",
          time_phrase_raw: "06:19",
          time_resolution: "explicit",
          context_snippets: [],
          cells: [],
          outcome_cells: null,
          outcome_text: null,
        },
      ],
    })).toBe(true);
  });

  it("does not retry when summary marker is already present", () => {
    expect(shouldRetryForMissingSummaryMarker({
      branches: ["summarizing"],
      summarizeEventsCount: 1,
      userMessage: "Встреча была непростая, возник конфликт интересов.",
      dueEvents: [
        {
          id: "event-1",
          description: "Встреча с клиентом",
          expected_at: "2026-05-26T03:19:00+00:00",
          planned_at: "2026-05-26T05:40:40.244+00:00",
          planned_local_date: "2026-05-26",
          status: "planned",
          time_phrase_raw: "06:19",
          time_resolution: "explicit",
          context_snippets: [],
          cells: [],
          outcome_cells: null,
          outcome_text: null,
        },
      ],
    })).toBe(false);
  });
});
