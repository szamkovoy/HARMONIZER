import { describe, expect, it } from "vitest";

import { initFsmState } from "./dialogFsm";
import {
  assistantFinalizeWithoutMarkers,
  assistantOfferedPractice,
  assistantAskedSummaryClarifyingQuestion,
  coerceFsmBeforeTurn,
  extractPlanningMarkersFromVisibleFinalize,
  filterPracticeLikePlannedEvents,
  isPracticeLikePlannedEventDesc,
  userAffirmsPracticeOffer,
  buildSummaryClarifyingQuestion,
  buildSummaryEventDidNotHappenBridge,
  userAnswerIsThinForSummary,
  userSaysEventDidNotHappen,
  userSignalsPlanningDone,
} from "./dialogTurnGuards";

describe("dialogTurnGuards", () => {
  it("detects planning done signals", () => {
    expect(userSignalsPlanningDone("Думаю, достаточно этого.")).toBe(true);
    expect(userSignalsPlanningDone("ещё прогулка")).toBe(false);
  });

  it("detects practice offer in assistant finalize", () => {
    const text =
      "1. Прогулка\nРекомендация: Идите спокойно.\n\nХотите, предложу короткую практику перед сном?";
    expect(assistantOfferedPractice(text)).toBe(true);
    expect(assistantFinalizeWithoutMarkers([{ role: "assistant", content: text }])).toBe(true);
  });

  it("filters practice-like planned events", () => {
    expect(isPracticeLikePlannedEventDesc("Минута медитации")).toBe(true);
    expect(isPracticeLikePlannedEventDesc("Прогулка в парке")).toBe(false);
    const filtered = filterPracticeLikePlannedEvents([
      { desc: "Прогулка в парке", recommendation: "a", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
      { desc: "Минута медитации", recommendation: "b", displayOrder: 2, time: null, timeNorm: null, cells: [], snippets: [] },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.desc).toBe("Прогулка в парке");
  });

  it("coerces planning to practice when user names meditation duration", () => {
    const fsm = initFsmState({
      tabMode: "plan",
      daySummaryRequested: false,
      hasDueEvents: false,
      targetChakra: 7,
      workingLocalDate: "2026-06-10",
    });
    const history = [
      {
        role: "assistant" as const,
        content:
          "1. Прогулка\nРекомендация: Тихо.\n\nХотите короткую практику перед сном?",
      },
    ];
    const next = coerceFsmBeforeTurn({
      fsm: { ...fsm, planningFinalized: true },
      history,
      userMessage: "Да, предложи мне одну минуту медитации.",
      isInitiate: false,
    });
    expect(next.branch).toBe("practice");
    expect(userAffirmsPracticeOffer("Да, предложи мне одну минуту медитации.", history)).toBe(true);
  });

  it("detects thin summary answers and event absence", () => {
    expect(userAnswerIsThinForSummary("Да, состоялось, всё хорошо.")).toBe(true);
    expect(userAnswerIsThinForSummary("Чувствовал спокойствие и лёгкую усталость.")).toBe(false);
    expect(userAnswerIsThinForSummary(
      "Я замечательно погулял по парку. Было время подумать, спланировать проект и увидеть общую картину. Я очень доволен этой прогулкой.",
    )).toBe(false);
    expect(userAnswerIsThinForSummary(
      "Ужин в кафе прошел замечательно, с друзьями покушали, пообщались, давно не виделись, поэтому все очень даже хорошо.",
    )).toBe(false);
    expect(userSaysEventDidNotHappen("Нет, медитации не было.")).toBe(true);
    expect(userSaysEventDidNotHappen("Нет")).toBe(true);
    expect(userSaysEventDidNotHappen("no")).toBe(true);
    expect(userAnswerIsThinForSummary("Нет")).toBe(false);
  });

  it("builds clarifying question for thin summary deferral", () => {
    const walkQuestion = buildSummaryClarifyingQuestion("Прогулка в парке", "ru");
    expect(walkQuestion).not.toContain("(");
    expect(walkQuestion).not.toContain("«");
    expect(walkQuestion).not.toContain("что было в теле и внутри");
    const saunaQuestion = buildSummaryClarifyingQuestion("Сходить в сауну и пообщаться с друзьями", "ru");
    expect(saunaQuestion.toLowerCase()).toContain("когда вы были в сауне");
    expect(saunaQuestion).not.toContain("(");
    expect(buildSummaryClarifyingQuestion("Пораньше лечь спать", "ru")).toContain("когда вы легли спать");
    expect(buildSummaryClarifyingQuestion("Walk in the park", "en")).toContain("Walk in the park");
  });

  it("detects model-visible clarifying questions in summary turns", () => {
    expect(assistantAskedSummaryClarifyingQuestion(
      "Звучит хорошо. Чтобы точнее отразить это в матрице, уточните: какие состояния там были?",
      "Рабочие задачи",
    )).toBe(true);
    expect(assistantAskedSummaryClarifyingQuestion(
      "Ясно, тогда закроем это событие. Теперь о рабочих задачах. Как они прошли?",
      "Рабочие задачи",
    )).toBe(false);
  });

  it("builds a short bridge when an event did not happen", () => {
    expect(buildSummaryEventDidNotHappenBridge(
      "Встреча с важным клиентом",
      "Фильм вечером",
      "ru",
    )).toBe("Жаль, что не сложилось. Как прошёл следующий пункт — Фильм вечером?");
  });

  it("salvages visible planning markers without meditation rows", () => {
    const text = [
      "План:",
      "",
      "1. Прогулка в парке",
      "Рекомендация: Идите в тишине.",
      "",
      "2. Ранний отход ко сну",
      "Рекомендация: Засыпайте спокойно.",
      "",
      "Хотите практику?",
    ].join("\n");
    const salvaged = extractPlanningMarkersFromVisibleFinalize(text, "ru");
    expect(salvaged).toHaveLength(2);
    expect(salvaged.map((item) => item.desc)).toEqual(["Прогулка в парке", "Ранний отход ко сну"]);
  });
});
