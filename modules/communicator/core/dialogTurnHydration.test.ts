import { describe, expect, it } from "vitest";

import {
  isFinalLikeTurnMode,
  mergeCompleteWithSession,
  needsAssistantTurnHydration,
  sessionAssistantMatchesTurn,
} from "./dialogTurnHydration";

describe("dialogTurnHydration", () => {
  it("treats fast-track and final recommendation turns as final-like", () => {
    expect(isFinalLikeTurnMode("fast_track_final")).toBe(true);
    expect(isFinalLikeTurnMode("final_recommendation")).toBe(true);
    expect(isFinalLikeTurnMode("inquiry")).toBe(false);
  });

  it("requests hydration when final complete is missing practicePicked", () => {
    expect(needsAssistantTurnHydration({
      fullText: "Подобрал практику ниже.",
      shouldClose: false,
      turnMode: "fast_track_final",
      modelTier: "premium",
      modelUsed: "gemini-test",
      iteration: 2,
    })).toBe(true);
  });

  it("does not hydrate a well-formed final complete payload", () => {
    expect(needsAssistantTurnHydration({
      fullText: "Финальная рекомендация",
      shouldClose: false,
      turnMode: "final_recommendation",
      modelTier: "premium",
      modelUsed: "gemini-test",
      iteration: 3,
      practicePicked: { id: "asana-1", kind: "yoga" },
    })).toBe(false);
  });

  it("matches session assistant by identical text when complete messageId is missing", () => {
    expect(sessionAssistantMatchesTurn({
      currentText: "Сегодня активна Вишуддха — подобрал практику ниже.",
      sessionText: "Сегодня активна Вишуддха — подобрал практику ниже.",
    })).toBe(true);
  });

  it("merges missing complete metadata from session sync", () => {
    expect(mergeCompleteWithSession({
      complete: {
        fullText: "Сегодня активна Вишуддха — подобрал практику ниже.",
        shouldClose: false,
      },
      sessionText: "Сегодня активна Вишуддха — подобрал практику ниже.",
      sessionMessageId: "msg-42",
      sessionMeta: {
        turnMode: "fast_track_final",
        modelTier: "premium",
        modelUsed: "gemini-test",
        iteration: 2,
        practicePicked: { id: "asana-1", kind: "yoga" },
        recommendationCorrected: { short_text: "new" },
        debug: { foo: "bar" },
      },
    })).toMatchObject({
      messageId: "msg-42",
      turnMode: "fast_track_final",
      modelTier: "premium",
      modelUsed: "gemini-test",
      iteration: 2,
      practicePicked: { id: "asana-1", kind: "yoga" },
      recommendationCorrected: { short_text: "new" },
      debugExport: { foo: "bar" },
    });
  });
});
