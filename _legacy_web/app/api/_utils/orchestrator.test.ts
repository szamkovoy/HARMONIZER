import { describe, expect, it } from "vitest";
import {
  contextSimilarity,
  greetingBypassDecision,
  shouldForceFreshDecision,
  validateOrchestratorDecision,
  type OrchestratorDecision,
} from "./orchestrator";

const previousDecision: OrchestratorDecision = {
  next_phase: "deepen_inquiry",
  reasoning: "previous",
  information_completeness: { user_state: 0.3 },
  information_density: 0.1,
  user_signals: ["terse"],
  should_close: false,
  decision_source: "fresh",
};

describe("orchestrator optimizations", () => {
  it("creates a deterministic greeting bypass decision", () => {
    const decision = greetingBypassDecision("daily_dialog", "Europe/Moscow");

    expect(decision.next_phase).toBe("contextual_greeting");
    expect(decision.decision_source).toBe("bypass_greeting");
    expect(decision.responder_hints?.tone).toBeTruthy();
  });

  it("reuses stable terse context but misses explicit transition intent", () => {
    const stable = contextSimilarity("ну такое", "не знаю", previousDecision);
    const transition = contextSimilarity("давай попробуем практику на 10 минут", "не знаю", previousDecision);

    expect(stable).toBeGreaterThan(0.8);
    expect(transition).toBeLessThan(0.8);
  });

  it("forces a fresh decision after two cache hits", () => {
    expect(
      shouldForceFreshDecision([
        { ...previousDecision, decision_source: "cache_reused" },
        { ...previousDecision, decision_source: "cache_reused" },
      ]),
    ).toBe(true);
  });

  it("preserves backend metadata during validation", () => {
    const decision = validateOrchestratorDecision(
      { ...previousDecision, decision_source: "cache_reused", cache_similarity: 0.91 },
      "collect_state",
    );

    expect(decision.decision_source).toBe("cache_reused");
    expect(decision.cache_similarity).toBe(0.91);
  });
});
