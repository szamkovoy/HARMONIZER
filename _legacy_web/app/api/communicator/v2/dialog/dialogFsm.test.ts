import { describe, expect, it } from "vitest";

import {
  advanceBranch,
  bumpSummaryAsked,
  initFsmState,
  isLastBranch,
  readFsmState,
  summaryAskedCount,
  type DialogFsmState,
} from "./dialogFsm";

const baseInit = {
  targetChakra: 4,
  workingLocalDate: "2026-06-09",
};

describe("initFsmState — flow per entry point", () => {
  it("home flow with due events: summarize, plan, then practice", () => {
    const fsm = initFsmState({ tabMode: null, daySummaryRequested: false, hasDueEvents: true, ...baseInit });
    expect(fsm.flow).toEqual(["summarizing", "planning", "practice"]);
    expect(fsm.branch).toBe("summarizing");
    expect(fsm.noPractice).toBe(false);
    expect(fsm.noGreeting).toBe(false);
    expect(fsm.targetChakra).toBe(4);
  });

  it("home flow without due events: skip summarizing", () => {
    const fsm = initFsmState({ tabMode: null, daySummaryRequested: false, hasDueEvents: false, ...baseInit });
    expect(fsm.flow).toEqual(["planning", "practice"]);
    expect(fsm.branch).toBe("planning");
  });

  it("day-tab add: planning only, no practice, no greeting", () => {
    const fsm = initFsmState({ tabMode: "add", daySummaryRequested: false, hasDueEvents: true, ...baseInit });
    expect(fsm.flow).toEqual(["planning"]);
    expect(fsm.noPractice).toBe(true);
    expect(fsm.noGreeting).toBe(true);
  });

  it("day-tab plan (Что делать?): summarize if due, then plan and practice", () => {
    const fsm = initFsmState({ tabMode: "plan", daySummaryRequested: false, hasDueEvents: true, ...baseInit });
    expect(fsm.flow).toEqual(["summarizing", "planning", "practice"]);
    expect(fsm.noPractice).toBe(false);
    expect(fsm.noGreeting).toBe(false);
  });

  it("day-tab plan without due events: planning then practice", () => {
    const fsm = initFsmState({ tabMode: "plan", daySummaryRequested: false, hasDueEvents: false, ...baseInit });
    expect(fsm.flow).toEqual(["planning", "practice"]);
    expect(fsm.noPractice).toBe(false);
  });

  it("explicit summarize-this-day: summarizing only, closes after wrap-up", () => {
    const fsm = initFsmState({ tabMode: "summary", daySummaryRequested: true, hasDueEvents: true, ...baseInit });
    expect(fsm.flow).toEqual(["summarizing"]);
    expect(fsm.noPractice).toBe(true);
  });
});

describe("advanceBranch", () => {
  it("walks summarizing -> planning -> practice -> done", () => {
    let fsm = initFsmState({ tabMode: null, daySummaryRequested: false, hasDueEvents: true, ...baseInit });
    expect(fsm.branch).toBe("summarizing");
    fsm = advanceBranch(fsm);
    expect(fsm.branch).toBe("planning");
    fsm = advanceBranch(fsm);
    expect(fsm.branch).toBe("practice");
    fsm = advanceBranch(fsm);
    expect(fsm.branch).toBe("done");
  });

  it("skips the practice branch entirely when noPractice is set", () => {
    // Simulate a flow that still lists practice but is flagged noPractice.
    const fsm: DialogFsmState = {
      v: 1,
      flow: ["planning", "practice"],
      branchIndex: 0,
      branch: "planning",
      summaryAsked: {},
      planningFinalized: false,
      practiceDecided: false,
      noPractice: true,
      noGreeting: false,
      targetChakra: 4,
      workingLocalDate: "2026-06-09",
    };
    const next = advanceBranch(fsm);
    expect(next.branch).toBe("done");
  });
});

describe("isLastBranch", () => {
  it("is true on the final non-skipped branch", () => {
    const fsm = initFsmState({ tabMode: null, daySummaryRequested: false, hasDueEvents: true, ...baseInit });
    expect(isLastBranch(fsm)).toBe(false); // summarizing
    expect(isLastBranch(advanceBranch(fsm))).toBe(false); // planning
    expect(isLastBranch(advanceBranch(advanceBranch(fsm)))).toBe(true); // practice
  });

  it("treats planning as last when practice is skipped (noPractice)", () => {
    const fsm = initFsmState({ tabMode: "add", daySummaryRequested: false, hasDueEvents: false, ...baseInit });
    expect(isLastBranch(fsm)).toBe(true);
  });
});

describe("summaryAsked counters", () => {
  it("counts clarifying questions per event id, capped by the caller at 1", () => {
    let fsm = initFsmState({ tabMode: null, daySummaryRequested: false, hasDueEvents: true, ...baseInit });
    expect(summaryAskedCount(fsm, "evt-1")).toBe(0);
    fsm = bumpSummaryAsked(fsm, "evt-1");
    expect(summaryAskedCount(fsm, "evt-1")).toBe(1);
    expect(summaryAskedCount(fsm, "evt-2")).toBe(0);
    expect(summaryAskedCount(fsm, null)).toBe(0);
  });
});

describe("readFsmState", () => {
  it("returns null when no fsm state is stored", () => {
    expect(readFsmState(null)).toBeNull();
    expect(readFsmState({})).toBeNull();
    expect(readFsmState({ dialog_fsm: { branch: "nonsense" } })).toBeNull();
  });

  it("round-trips a stored state", () => {
    const fsm = initFsmState({ tabMode: null, daySummaryRequested: false, hasDueEvents: true, ...baseInit });
    const restored = readFsmState({ dialog_fsm: fsm });
    expect(restored).toMatchObject({ branch: "summarizing", flow: ["summarizing", "planning", "practice"], targetChakra: 4 });
  });
});
