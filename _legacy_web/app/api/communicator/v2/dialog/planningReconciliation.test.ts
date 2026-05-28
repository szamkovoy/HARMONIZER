import { describe, expect, it } from "vitest";

import {
  buildPlanningCandidateParsePhrase,
  buildSummaryClassificationCandidate,
  buildSummaryNormalizationSourceText,
  pendingSummaryEventIds,
  readPendingArtifactState,
} from "./planningReconciliation";

describe("readPendingArtifactState", () => {
  it("reads valid pending planning queue from trigger_meta", () => {
    const state = readPendingArtifactState({
      pending_planning_reconciliation: {
        due_at: "2026-05-26T10:10:00.000Z",
        updated_at: "2026-05-26T10:00:00.000Z",
        planning_candidates: [
          {
            candidate_id: "c1",
            desc: "Велосипедная прогулка",
            time: "вечером",
            timeNorm: "сегодня вечером",
            cells: [{ chakra: 1, sphere: 2, weight: 0.5 }],
            snippets: ["Хочу покататься на велосипеде вечером"],
            queued_at: "2026-05-26T10:00:00.000Z",
          },
        ],
        summary_candidates: [
          {
            candidate_id: "s1",
            event_id: "event-1",
            description: "Встреча с клиентом",
            planned_local_date: "2026-05-26",
            expected_at: "2026-05-26T10:00:00.000Z",
            time_phrase_raw: "утром",
            time_resolution: "approximate",
            outcome: "Встреча прошла конструктивно",
            proposed_outcome_cells: [{ chakra: 4, sphere: 6, weight: 1 }],
            queued_at: "2026-05-26T10:00:00.000Z",
          },
        ],
      },
    });

    expect(state).not.toBeNull();
    expect(state?.planning_candidates).toHaveLength(1);
    expect(state?.planning_candidates[0]?.desc).toBe("Велосипедная прогулка");
    expect(state?.summary_candidates[0]?.event_id).toBe("event-1");
  });

  it("keeps backward compatibility with old planning-only queue shape", () => {
    const state = readPendingArtifactState({
      pending_planning_reconciliation: {
        due_at: "2026-05-26T10:10:00.000Z",
        updated_at: "2026-05-26T10:00:00.000Z",
        candidates: [{ candidate_id: "c1", desc: "Театр" }],
      },
    });

    expect(state?.planning_candidates).toHaveLength(1);
    expect(state?.summary_candidates).toHaveLength(0);
  });

  it("returns null for empty or malformed queues", () => {
    expect(readPendingArtifactState(null)).toBeNull();
    expect(readPendingArtifactState({
      pending_planning_reconciliation: {
        due_at: "2026-05-26T10:10:00.000Z",
        updated_at: "2026-05-26T10:00:00.000Z",
        planning_candidates: [{ candidate_id: "", desc: "" }],
      },
    })).toBeNull();
  });
});

describe("pendingSummaryEventIds", () => {
  it("returns summary event ids queued for delayed reconciliation", () => {
    expect([...pendingSummaryEventIds({
      pending_planning_reconciliation: {
        due_at: "2026-05-26T10:10:00.000Z",
        updated_at: "2026-05-26T10:00:00.000Z",
        planning_candidates: [],
        summary_candidates: [
          {
            candidate_id: "s1",
            event_id: "event-1",
            description: "Прогулка",
            planned_local_date: "2026-05-26",
            expected_at: "2026-05-26T10:00:00.000Z",
          },
        ],
      },
    })]).toEqual(["event-1"]);
  });
});

describe("buildPlanningCandidateParsePhrase", () => {
  it("keeps description context before an ambiguous time phrase", () => {
    expect(buildPlanningCandidateParsePhrase({
      desc: "Ужин после театра и сон в 23:30",
      time: "в 11.30",
      timeNorm: null,
    })).toBe("Ужин после театра и сон в 23:30. в 11.30");
  });
});

describe("summary outcome helpers", () => {
  it("keeps contract context in normalization source text", () => {
    expect(buildSummaryNormalizationSourceText({
      description: "Обсуждение контракта с клиентом",
      outcome: "Пришлось настоять на важных условиях, но удалось продвинуться к договоренности",
      planned_local_date: "2026-05-27",
      time_phrase_raw: "днем",
    })).toContain("Событие: Обсуждение контракта с клиентом.");
  });

  it("keeps theater context as classifier anchor even when outcome mentions recovery side effects", () => {
    expect(buildSummaryClassificationCandidate(
      {
        candidate_id: "s-theater",
        description: "Поход в театр и филармонию",
        outcome: "Удалось расслабиться, потом лучше спалось",
      },
      "Культурный выход в театр и филармонию дал эстетическое впечатление и отдых",
    )).toEqual({
      candidate_id: "s-theater",
      event_description: "Поход в театр и филармонию",
      normalized_outcome: "Культурный выход в театр и филармонию дал эстетическое впечатление и отдых",
    });
  });

  it("falls back to event description plus raw contract outcome when normalization is missing", () => {
    expect(buildSummaryClassificationCandidate(
      {
        candidate_id: "s-contract",
        description: "Разговор по контракту",
        outcome: "Удалось прояснить рабочие договоренности",
      },
      null,
    )).toEqual({
      candidate_id: "s-contract",
      event_description: "Разговор по контракту",
      normalized_outcome: "Удалось прояснить рабочие договоренности",
    });
  });
});
