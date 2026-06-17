import { describe, expect, it } from "vitest";

import type { MessageRecord } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";
import { initFsmState } from "./dialogFsm";
import {
  assistantFinalizeWithoutMarkers,
  assistantOfferedPractice,
  assistantAskedSummaryClarifyingQuestion,
  coerceFsmBeforeTurn,
  extractPlanningMarkersFromVisibleFinalize,
  filterPracticeLikePlannedEvents,
  isPracticeLikePlannedEventDesc,
  mergePlanningMarkersWithVisibleFinalize,
  userAffirmsPracticeOffer,
  buildSummaryClarifyingQuestion,
  buildSummaryEventDidNotHappenBridge,
  userAnswerIsThinForSummary,
  userSaysEventDidNotHappen,
  userSignalsPlanningDone,
} from "./dialogTurnGuards";

function assistantMsg(content: string): MessageRecord {
  return { id: "m", role: "assistant", content, transcript: null, meta: null, created_at: null };
}

describe("dialogTurnGuards", () => {
  it("detects planning done signals", () => {
    expect(userSignalsPlanningDone("Думаю, достаточно этого.")).toBe(true);
    expect(userSignalsPlanningDone("ещё прогулка")).toBe(false);
  });

  it("detects practice offer in assistant finalize", () => {
    const text =
      "1. Прогулка\nРекомендация: Идите спокойно.\n\nХотите, предложу короткую практику перед сном?";
    expect(assistantOfferedPractice(text)).toBe(true);
    expect(assistantFinalizeWithoutMarkers([assistantMsg(text)])).toBe(true);
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
      assistantMsg("1. Прогулка\nРекомендация: Тихо.\n\nХотите короткую практику перед сном?"),
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

  it("does NOT skip planning when the summary final merely mentions practice and the planning reply contains 'потом'", () => {
    // Regression: the Home overdue→plan flow lost all planned actions because the
    // summarizing FINAL message says "три коротких медитации" (a practice word) and
    // ends with a question, and the user's first planning reply happened to contain
    // "потом" ("куда её потом девать"). The old loose lock coerced planning→practice
    // and skipped the whole planning branch, so nothing persisted.
    const fsm = initFsmState({
      tabMode: "plan",
      daySummaryRequested: false,
      hasDueEvents: true,
      targetChakra: 7,
      workingLocalDate: "2026-06-11",
    });
    const planningFsm = { ...fsm, branch: "planning" as const, branchIndex: fsm.flow.indexOf("planning") };
    const summaryFinal = assistantMsg(
      "Этот день прожит в энергии шестой чакры. Из практик в течение дня вы выполнили три коротких медитации — в сумме пять минут. Что важного вы хотите запланировать на текущий день?",
    );
    const next = coerceFsmBeforeTurn({
      fsm: planningFsm,
      history: [summaryFinal],
      userMessage:
        "Хочу съездить за лодкой, но не уверен, что куплю — куда её потом девать. А ещё хочу на озеро отдохнуть.",
      isInitiate: false,
    });
    expect(next.branch).toBe("planning");
    expect(next.planningFinalized).toBe(false);
  });

  it("detects bare and curated non-occurrence phrasings, without false-positives on happened answers", () => {
    // Unambiguous, language-stable bare negations.
    expect(userSaysEventDidNotHappen("Нет")).toBe(true);
    expect(userSaysEventDidNotHappen("Нет.")).toBe(true);
    expect(userSaysEventDidNotHappen("no")).toBe(true);
    expect(userSaysEventDidNotHappen("Не.")).toBe(true);
    // Curated non-occurrence phrasings the model used to mishandle (kept asking
    // about the lived state instead of closing the event).
    expect(userSaysEventDidNotHappen("Книгу не почитал, не до того уже было, не хватило времени.")).toBe(true);
    expect(userSaysEventDidNotHappen("На тренировку я не пошел, не было времени, не успел.")).toBe(true);
    expect(userSaysEventDidNotHappen("Нет, в кино я не ходил.")).toBe(true);
    expect(userSaysEventDidNotHappen("Так и не дошёл до зала.")).toBe(true);
    expect(userSaysEventDidNotHappen("Не удалось лечь пораньше.")).toBe(true);
    expect(userSaysEventDidNotHappen("Встреча не состоялась, перенесли.")).toBe(true);
    expect(userSaysEventDidNotHappen("Совсем забыл про это.")).toBe(true);
    expect(userSaysEventDidNotHappen("Didn't get to it, no time.")).toBe(true);
    expect(userSaysEventDidNotHappen("I couldn't make it.")).toBe(true);
    // Clearly-happened answers must NOT be treated as a no-show — including the
    // tricky "ничего особенного не было" (event happened, just unremarkable).
    expect(userSaysEventDidNotHappen("Да, получилось, но в этом ничего особенного не было.")).toBe(false);
    expect(userSaysEventDidNotHappen("Поработал продуктивно, удалось закрыть задачу.")).toBe(false);
    expect(userSaysEventDidNotHappen("Да, с другом встретились, замечательно посидели.")).toBe(false);
    expect(userSaysEventDidNotHappen("Гулял в парке, было спокойно.")).toBe(false);
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
    // "Нет, медитации не было." carries extra content → now delegated to the LLM
    // (no longer caught by the minimal bare-no backstop).
    expect(userSaysEventDidNotHappen("Нет, медитации не было.")).toBe(false);
    expect(userSaysEventDidNotHappen("Нет")).toBe(true);
    expect(userSaysEventDidNotHappen("no")).toBe(true);
    expect(userAnswerIsThinForSummary("Нет")).toBe(false);
  });

  it("builds a thematic, right-sized clarifying question for thin summary deferral", () => {
    // The question must read like a friend picking up the thread: a real question,
    // no parentheses, no quoted event titles, and never the fixed
    // "тело, настроение, мысли или отношения" checklist.
    const walkQuestion = buildSummaryClarifyingQuestion("Прогулка в парке", "ru");
    expect(walkQuestion).not.toContain("(");
    expect(walkQuestion).not.toContain("«");
    expect(walkQuestion).toContain("?");
    expect(walkQuestion).not.toContain("тело, настроение, мысли или отношения");

    // Work events ask about the texture of the process, not a generic checklist.
    const workQuestion = buildSummaryClarifyingQuestion("Работа, решение текущих вопросов", "ru");
    expect(workQuestion).not.toContain("(");
    expect(workQuestion).not.toContain("тело, настроение, мысли или отношения");
    expect(/фокус|увлеч|людьми|процесс|выматыв/i.test(workQuestion)).toBe(true);

    // A tiny action stays light and does not interrogate.
    const tinyQuestion = buildSummaryClarifyingQuestion("Пораньше лечь спать", "ru");
    expect(tinyQuestion).toContain("?");
    expect(tinyQuestion).not.toContain("тело, настроение, мысли или отношения");

    // English path produces a real, non-empty question without quoting the title.
    const enQuestion = buildSummaryClarifyingQuestion("Walk in the park", "en");
    expect(enQuestion).toContain("?");
    expect(enQuestion).not.toContain("\"");
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

  it("salvages a long label on a word boundary instead of cutting mid-word", () => {
    const text = [
      "1. Косить траву, красить крышу, убрать территорию и дом, проверить колодец",
      "Рекомендация: Делайте с заботой.",
      "",
      "Хотите практику?",
    ].join("\n");
    const [salvaged] = extractPlanningMarkersFromVisibleFinalize(text, "ru");
    // No mid-word cut (the old bug produced "убрать терр").
    expect(salvaged.desc).not.toMatch(/терр$/);
    expect(salvaged.desc.endsWith(" ")).toBe(false);
    expect(salvaged.desc.length).toBeLessThanOrEqual(60);
  });

  it("never defaults salvaged spheres to sphere 4 (friends/family) for chores or rest", () => {
    const text = [
      "1. Косить траву и убрать территорию дачи",
      "Рекомендация: Наводите порядок без спешки.",
      "",
      "2. Катание на велосипеде до озера и купание",
      "Рекомендация: Почувствуйте лёгкость.",
      "",
      "Хотите практику?",
    ].join("\n");
    const salvaged = extractPlanningMarkersFromVisibleFinalize(text, "ru");
    for (const marker of salvaged) {
      expect(marker.cells.some((cell) => cell.sphere === 4)).toBe(false);
    }
    // Chores → sphere 1 (body/home); the lake ride → sphere 2 (rest) appears.
    expect(salvaged[0]?.cells.some((cell) => cell.sphere === 1)).toBe(true);
    expect(salvaged[1]?.cells.some((cell) => cell.sphere === 2)).toBe(true);
  });

  it("infers sphere 4 only when people/relationships are actually present", () => {
    const text = [
      "1. Встреча с друзьями за ужином",
      "Рекомендация: Будьте открыты.",
      "",
      "Хотите практику?",
    ].join("\n");
    const [salvaged] = extractPlanningMarkersFromVisibleFinalize(text, "ru");
    expect(salvaged.cells.some((cell) => cell.sphere === 4)).toBe(true);
  });

  it("backfills missing planning recommendations from the visible finalize", () => {
    const merged = mergePlanningMarkersWithVisibleFinalize(
      [
        {
          desc: "Bike + lac + baignade",
          recommendation: null,
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 2, weight: 0.8 }, { sphere: 1, weight: 0.2 }],
          snippets: [],
        },
      ],
      [
        {
          desc: "Bike + lac + baignade",
          recommendation: "Profitez du trajet sans vous presser.",
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 2, weight: 1 }],
          snippets: [],
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.recommendation).toBe("Profitez du trajet sans vous presser.");
    expect(merged[0]?.cells).toEqual([{ sphere: 2, weight: 0.8 }, { sphere: 1, weight: 0.2 }]);
  });
});
