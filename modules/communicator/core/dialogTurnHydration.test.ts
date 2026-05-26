import { describe, expect, it } from "vitest";

import {
  isFinalLikeTurnMode,
  mergeCompleteWithSession,
  needsAssistantTurnHydration,
  sessionAssistantMatchesTurn,
  turnModeCarriesPractice,
} from "./dialogTurnHydration";

describe("dialogTurnHydration", () => {
  it("treats practice and no-practice finals as final-like", () => {
    expect(isFinalLikeTurnMode("fast_track_final")).toBe(true);
    expect(isFinalLikeTurnMode("final_recommendation")).toBe(true);
    expect(isFinalLikeTurnMode("final_without_practice")).toBe(true);
    expect(isFinalLikeTurnMode("practice_repick")).toBe(true);
    expect(isFinalLikeTurnMode("inquiry")).toBe(false);
  });

  it("requires practice payload only for card-carrying final turns", () => {
    expect(turnModeCarriesPractice("final_recommendation")).toBe(true);
    expect(turnModeCarriesPractice("practice_repick")).toBe(true);
    expect(turnModeCarriesPractice("final_without_practice")).toBe(false);
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

  it("does not require practicePicked for final_without_practice", () => {
    expect(needsAssistantTurnHydration({
      fullText: "Пусть день идет в спокойном темпе.",
      shouldClose: true,
      turnMode: "final_without_practice",
      modelTier: "standard",
      modelUsed: "gemini-test",
      iteration: 3,
    })).toBe(false);
  });

  it("matches session assistant by identical text when complete messageId is missing", () => {
    expect(sessionAssistantMatchesTurn({
      currentText: "Сегодня активна Вишуддха — подобрал практику ниже.",
      sessionText: "Сегодня активна Вишуддха — подобрал практику ниже.",
    })).toBe(true);
  });

  it("matches session assistant after server-side sanitation removes stray English hints", () => {
    expect(sessionAssistantMatchesTurn({
      currentText: "Сегодня важна ясность (practice hint for internal use).\n\nПопробуйте практику ниже.",
      sessionText: "Сегодня важна ясность.\n\nПопробуйте практику ниже.",
    })).toBe(true);
  });

  it("matches session assistant after server-side punctuation cleanup", () => {
    expect(sessionAssistantMatchesTurn({
      currentText: "Это хороший момент , чтобы замедлиться.\n\n, Практика ниже.",
      sessionText: "Это хороший момент, чтобы замедлиться.\n\nПрактика ниже.",
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
