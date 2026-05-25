import { describe, expect, it } from "vitest";

import { chooseDialogBranches } from "./dialogBranching";
import { shouldServerEscalateToFinalRecommendation } from "./dialogArcOrchestrator";
import { openingDayQuestionForContext } from "./dialogOpeningHints";

describe("dialogOpeningHints", () => {
  it("asks about today plans in morning planning branch", () => {
    const hint = openingDayQuestionForContext("morning", ["planning"]);
    expect(hint).toContain("планы на сегодня");
    expect(hint).not.toContain("завтра");
  });

  it("asks about tomorrow in evening planning branch", () => {
    const hint = openingDayQuestionForContext("evening", ["planning"]);
    expect(hint).toContain("завтра");
  });

  it("prioritizes summarizing before planning when both branches are active", () => {
    const hint = openingDayQuestionForContext("morning", ["summarizing", "planning"]);
    expect(hint).toContain("сначала про событие");
    expect(hint).toContain("затем про ближайшие планы");
  });
});

describe("chooseDialogBranches opening override", () => {
  it("keeps planning on opening even when anti-replan would suppress it", () => {
    const branches = chooseDialogBranches({
      phaseTime: "morning",
      dueEventsCount: 0,
      userMessage: "",
      hoursSinceLastPlanning: 0.1,
      planTomorrowMarker: false,
      forcePlanningOnOpening: true,
    });
    expect(branches).toContain("planning");
  });
});

describe("shouldServerEscalateToFinalRecommendation", () => {
  it("escalates confident inquiry without READY marker", () => {
    expect(
      shouldServerEscalateToFinalRecommendation({
        turnMode: "inquiry",
        validation: { confident: true },
        hasReadyMarker: false,
        hasRequiredBranchArtifacts: true,
      }),
    ).toBe(true);
  });

  it("does not escalate catalog conflict inquiry", () => {
    expect(
      shouldServerEscalateToFinalRecommendation({
        turnMode: "inquiry",
        validation: { confident: false },
        hasReadyMarker: false,
        hasRequiredBranchArtifacts: true,
      }),
    ).toBe(false);
  });

  it("does not escalate until branch artifacts are present", () => {
    expect(
      shouldServerEscalateToFinalRecommendation({
        turnMode: "inquiry",
        validation: { confident: true },
        hasReadyMarker: false,
        hasRequiredBranchArtifacts: false,
      }),
    ).toBe(false);
  });
});
