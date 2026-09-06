import { describe, expect, it } from "vitest";
import {
  isConversationExpired,
  lastAssistantDecisions,
  loadHistory,
  normalizeTurnHistory,
  todayLocalDate,
} from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";
import {
  buildEmptyContentRepairInstruction,
  buildLeakedMarkupRepairInstruction,
  buildPlanningClosureInterpretRepairInstruction,
  buildPlanningFinalizeRepairInstruction,
  buildPracticeDeclineInterpretRepairInstruction,
  planningFinalizeArtifactsReady,
} from "@legacy/app/api/communicator/v2/dialog/planningTurnRepair";
import {
  buildSummaryCloseRepairInstruction,
  buildSummaryRepairInstruction,
  classifySummaryRepairMode,
} from "@legacy/app/api/communicator/v2/dialog/summaryTurnRepair";
import { getDialogScaffoldStrings } from "@legacy/app/api/_utils/dialogScaffold";
import type { AppContentLocale } from "@legacy/app/api/_utils/contentLocales";

const ALL_LOCALES: AppContentLocale[] = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"];

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
            branches: ["planning"],
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
          branches: ["planning"],
          dialog_branches: ["planning"],
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

describe("summary repair helpers", () => {
  it("classifies a mixed clarifying turn as clarify_current_only", () => {
    const visibleText = [
      "Bene, un carico di cose da fare. Hai avuto la sensazione di essere focalizzata e precisa, o c'è stato qualche momento di tensione e spinta per portare tutto a termine?",
      "",
      "E per andare in negozio per la barca, com'è andata?",
    ].join("\n");

    expect(classifySummaryRepairMode({
      visibleText,
      currentEventDescription: "Lavorare sulle attività lavorative",
      nextEventDescription: "Andare in negozio per la barca",
      hasSummaryMarker: true,
    })).toBe("clarify_current_only");
  });

  it("classifies a mixed close-and-next turn as close_and_ask_next", () => {
    const visibleText = [
      "Capito. Si è concluso bene?",
      "",
      "E per andare in negozio per la barca, com'è andata?",
    ].join("\n");

    expect(classifySummaryRepairMode({
      visibleText,
      currentEventDescription: "Lavorare sulle attività lavorative",
      nextEventDescription: "Andare in negozio per la barca",
      hasSummaryMarker: true,
    })).toBe("close_and_ask_next");
  });

  it("builds a retry instruction that keeps the next event out of a clarifying rewrite", () => {
    const instruction = buildSummaryRepairInstruction({
      baseInstruction: "BASE",
      mode: "clarify_current_only",
      currentEventDescription: "Lavorare sulle attività lavorative",
      nextEventDescription: "Andare in negozio per la barca",
    });

    expect(instruction).toContain("BASE");
    expect(instruction).toContain("Emit NO [SUMMARIZE_EVENT] marker");
    expect(instruction).toContain("Do NOT mention or ask about the next event");
  });

  it("builds a retry instruction that forces a close when the state is already sufficient", () => {
    const instruction = buildSummaryCloseRepairInstruction({
      baseInstruction: "BASE",
      currentEventDescription: "Lavorare sulle attività lavorative",
      nextEventDescription: "Andare in negozio per la barca",
    });

    expect(instruction).toContain("BASE");
    expect(instruction).toContain("already gave enough lived-state detail");
    expect(instruction).toContain("Emit the [SUMMARIZE_EVENT] marker");
    expect(instruction).toContain("ask exactly ONE short question about the next event");
  });
});

describe("planning repair helpers", () => {
  it("requires a retry when add-flow finalize still lacks recommendations", () => {
    expect(planningFinalizeArtifactsReady({
      noGreeting: true,
      explicitMarkers: [
        {
          desc: "Correre 3 km",
          recommendation: null,
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [],
          snippets: [],
        },
      ],
      salvagedVisibleMarkers: [],
      hasDayFocusMarker: false,
    })).toBe(false);
  });

  it("accepts add-flow finalize artifacts when recommendations are present", () => {
    expect(planningFinalizeArtifactsReady({
      noGreeting: true,
      explicitMarkers: [
        {
          desc: "Correre 3 km",
          recommendation: "Portala con un ritmo che ti rimette al centro.",
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [],
          snippets: [],
        },
      ],
      salvagedVisibleMarkers: [],
      hasDayFocusMarker: false,
    })).toBe(true);
  });

  it("requires day focus for greeted-flow finalize even when the numbered list was salvaged", () => {
    expect(planningFinalizeArtifactsReady({
      noGreeting: false,
      explicitMarkers: [],
      salvagedVisibleMarkers: [
        {
          desc: "Поездка на родник",
          recommendation: "Отнеситесь к поездке как к ритуалу.",
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [],
          snippets: [],
        },
      ],
      hasDayFocusMarker: false,
      hasSalvagedDayFocus: false,
    })).toBe(false);

    expect(planningFinalizeArtifactsReady({
      noGreeting: false,
      explicitMarkers: [],
      salvagedVisibleMarkers: [
        {
          desc: "Поездка на родник",
          recommendation: "Отнеситесь к поездке как к ритуалу.",
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [],
          snippets: [],
        },
      ],
      hasDayFocusMarker: false,
      hasSalvagedDayFocus: true,
    })).toBe(true);
  });

  it("builds a retry instruction that forbids more gathering questions", () => {
    const instruction = buildPlanningFinalizeRepairInstruction({
      baseInstruction: "BASE",
      noGreeting: true,
    });

    expect(instruction).toContain("BASE");
    expect(instruction).toContain("FINALIZE it now");
    expect(instruction).toContain("Do NOT ask whether to add anything else");
    expect(instruction).toContain("Do NOT emit [CORRECT_RECOMMENDATION]");
  });

  it("builds a greeted-flow retry that requires day recommendation without scaffold", () => {
    const instruction = buildPlanningFinalizeRepairInstruction({
      baseInstruction: "BASE",
      noGreeting: false,
    });
    expect(instruction).toContain("CORRECT_RECOMMENDATION");
    expect(instruction).toMatch(/no conversational ack/i);
  });

  it("builds a planning-closure interpret repair that classifies by meaning, not phrases", () => {
    const instruction = buildPlanningClosureInterpretRepairInstruction({
      baseInstruction: "BASE",
      noGreeting: false,
    });
    expect(instruction).toContain("BASE");
    expect(instruction).toMatch(/BY MEANING/i);
    expect(instruction).toMatch(/do not look for fixed phrases/i);
    expect(instruction).toMatch(/If you cannot tell/i);
    expect(instruction).not.toMatch(/больше планов/i);
    expect(instruction).not.toMatch(/that's all/i);
  });

  it("builds a planning-closure repair that finalizes after the clarifier was already asked", () => {
    const instruction = buildPlanningClosureInterpretRepairInstruction({
      baseInstruction: "BASE",
      noGreeting: false,
      alreadyClarified: true,
    });
    expect(instruction).toMatch(/already asked a clarifier/i);
    expect(instruction).toMatch(/FINALIZE now/i);
    expect(instruction).not.toMatch(/If you cannot tell/i);
  });

  it("builds a practice-decline interpret repair that classifies by meaning, not phrases", () => {
    const instruction = buildPracticeDeclineInterpretRepairInstruction({
      baseInstruction: "BASE",
    });
    expect(instruction).toContain("BASE");
    expect(instruction).toMatch(/BY MEANING/i);
    expect(instruction).toMatch(/\[PRACTICE_DECLINED\]/);
    expect(instruction).toMatch(/If you cannot tell/i);
    expect(instruction).not.toMatch(/no time/i);
    expect(instruction).not.toMatch(/maybe later/i);
  });

  it("builds a leaked-markup retry that keeps square-bracket markers and forbids XML", () => {
    const instruction = buildLeakedMarkupRepairInstruction({ baseInstruction: "BASE" });
    expect(instruction).toContain("BASE");
    expect(instruction).toContain("square brackets");
    expect(instruction).toMatch(/never emit XML/i);
    expect(instruction).toContain("natural language only");
  });

  it("builds an empty-content repair instruction that asks for natural visible reply", () => {
    const instruction = buildEmptyContentRepairInstruction({ baseInstruction: "BASE" });
    expect(instruction).toContain("BASE");
    expect(instruction).toMatch(/NO user-visible text/i);
    expect(instruction).toContain("natural language only");
    expect(instruction).toContain("square brackets");
    expect(instruction).toMatch(/never emit XML/i);
    expect(instruction).toMatch(/required invisible markers AND a complete visible reply/i);
  });
});

describe("emptyRecoveryPrompt scaffold string (deterministic fallback contract)", () => {
  for (const locale of ALL_LOCALES) {
    it(`provides a non-empty emptyRecoveryPrompt for ${locale}`, () => {
      const s = getDialogScaffoldStrings(locale);
      expect(s.emptyRecoveryPrompt.trim().length).toBeGreaterThan(0);
    });
  }
});

describe("summaryAlreadyComplete scaffold string (day-summary empty due)", () => {
  for (const locale of ALL_LOCALES) {
    it(`provides a non-empty summaryAlreadyComplete for ${locale}`, () => {
      const s = getDialogScaffoldStrings(locale);
      expect(s.summaryAlreadyComplete.trim().length).toBeGreaterThan(0);
    });
  }

  it("keeps the Russian source of truth", () => {
    expect(getDialogScaffoldStrings("ru").summaryAlreadyComplete).toBe(
      "Все неподытоженные действия уже подытожены.",
    );
  });
});

