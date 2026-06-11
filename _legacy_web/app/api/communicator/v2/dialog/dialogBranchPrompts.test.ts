import { describe, expect, it } from "vitest";

import {
  buildPlanningPrompt,
  buildPlanningFinalVisibleText,
  buildSummarizingPrompt,
  injectPlanningActionsVisibleList,
  injectPlanningDayFocus,
  type BrainPromptContext,
} from "./dialogBranchPrompts";

const brainCtx: BrainPromptContext = {
  locale: "ru",
  languageName: "Russian",
  addressForm: "вы",
  dayOfWeek: "Tuesday",
  dateLabel: "10 June 2026",
  timeOfDay: "evening" as const,
  localHour: 19,
  phaseTime: "evening",
  targetChakraNumber: 4,
  targetChakraLabel: "4",
  targetChakraAccusative: "4",
  targetChakraExplain: "heart",
  harmonicStates: ["warmth"],
  dissonantStates: ["cold"],
  planetOfDay: "Moon",
  tonalRegister: "soft",
  lifeSpheresBaseline: "1=body",
  planningSphereLens: null,
  existingDayFocus: null,
};

describe("buildSummarizingPrompt", () => {
  it("does not anchor every turn to a calendar date", () => {
    const { userInstruction } = buildSummarizingPrompt(brainCtx, {
      isOpening: false,
      currentEvent: { ref: "evt-1", description: "Прогулка в парке" },
      nextEvent: { description: "Просмотр фильма" },
      completedEarlierEvents: [],
      isLastEvent: false,
      clarifyingAlreadyAsked: false,
      healthContext: "",
      practicesContext: "",
      summaryWorkingLocalDate: "2026-06-09",
      currentEventPlannedLocalDate: "2026-06-09",
      continuesToPlanning: false,
    });
    expect(userInstruction).not.toMatch(/Anchor your wording/i);
    expect(userInstruction).not.toMatch(/9 июня/i);
    expect(userInstruction).toMatch(/ONLY that event/i);
    expect(userInstruction).toMatch(/exactly one question about the NEXT event/i);
  });
});

describe("injectPlanningDayFocus", () => {
  it("replaces improvised chakra focus with marker-backed day recommendation", () => {
    const text = [
      "Понял вас. Три важных события — хороший план.",
      "",
      "Сегодняшняя энергия шестой чакры — про ясность ума.",
      "",
      "1. Прогулка в парке",
      "Рекомендация: Идите спокойно.",
    ].join("\n");
    const result = injectPlanningDayFocus(text, "День ясности: во всём ищите главное за деталями.");
    expect(result).toContain("Понял вас. Три важных события");
    expect(result).toContain("День ясности: во всём ищите главное за деталями.");
    expect(result).not.toContain("Сегодняшняя энергия");
    expect(result).toContain("1. Прогулка в парке");
  });
});

describe("buildPlanningPrompt", () => {
  it("frames day focus as recommendation, not forecast", () => {
    const { userInstruction } = buildPlanningPrompt(brainCtx, {
      isOpening: false,
      noPractice: false,
      noGreeting: false,
      userSignaledDone: true,
      planningLocked: false,
    });
    expect(userInstruction).toMatch(/NOT a forecast/i);
    expect(userInstruction).toMatch(/may be fuller/i);
    expect(userInstruction).toMatch(/polite suggestions/i);
  });

  it("forbids day-focus markers in Day tab add flow", () => {
    const { userInstruction } = buildPlanningPrompt(brainCtx, {
      isOpening: false,
      noPractice: true,
      noGreeting: true,
      userSignaledDone: true,
      planningLocked: false,
    });
    expect(userInstruction).toMatch(/NEVER emit \[CORRECT_RECOMMENDATION\]/i);
    expect(userInstruction).toMatch(/only PLANNED_EVENT markers are allowed/i);
  });
});

describe("buildPlanningFinalVisibleText", () => {
  it("places day focus first, actions second, and practice question last", () => {
    const result = buildPlanningFinalVisibleText({
      visibleText: [
        "Вот таким видится день.",
        "",
        "Хотите короткую практику на 5 минут?",
        "",
        "1. Рабочие задачи",
        "Рекомендация: Сначала увидьте целое.",
      ].join("\n"),
      dayFocus: "Сегодня держите ясность и внутреннюю тишину.",
      locale: "ru",
      includePracticeQuestion: true,
      events: [
        { desc: "Рабочие задачи", recommendation: "Сначала увидьте целое.", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
      ],
    });

    expect(result).toBe([
      "Сегодня держите ясность и внутреннюю тишину.",
      "",
      "1. Рабочие задачи",
      "Рекомендация: Сначала увидьте целое.",
      "",
      "Хотите сейчас выполнить практику: медитацию, дыхание или асаны? Если да, назовите тип и примерную длительность — или скажите, что сегодня без практики.",
    ].join("\n"));
  });

  it("drops pre-final add-more questions from the deterministic final", () => {
    const result = buildPlanningFinalVisibleText({
      visibleText: [
        "Хороший набор. Есть ли ещё что-то важное, что вы хотели бы прожить сегодня осознанно?",
        "",
        "Сегодня держите ясность.",
        "",
        "1. Сауна",
        "Рекомендация: Отдохните.",
      ].join("\n"),
      dayFocus: "Сегодня держите ясность.",
      locale: "ru",
      includePracticeQuestion: true,
      events: [
        { desc: "Сауна", recommendation: "Отдохните.", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
      ],
    });

    expect(result).not.toContain("Есть ли ещё");
    expect(result).toContain("1. Сауна");
  });
});

describe("injectPlanningActionsVisibleList", () => {
  it("replaces broken numbered list with marker-backed titles", () => {
    const text = [
      "Итак, ваши три дела:",
      "",
      "1. — постарайтесь в разговоре с продавцами",
      "",
      "2. — подойдите к задачам спокойно",
      "",
      "И ранний отход ко сну станет завершением дня.",
    ].join("\n");
    const result = injectPlanningActionsVisibleList(
      text,
      [
        { desc: "Выбор саженцев яблони", recommendation: "Почувствуйте связь с будущим", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
        { desc: "Рабочие моменты в офисе", recommendation: "Сохраните внутреннюю тишину", displayOrder: 2, time: null, timeNorm: null, cells: [], snippets: [] },
      ],
      "ru",
    );
    expect(result).toContain("1. Выбор саженцев яблони");
    expect(result).toContain("Рекомендация: Почувствуйте связь с будущим");
    expect(result).toContain("2. Рабочие моменты в офисе");
    expect(result).toContain("И ранний отход ко сну");
    expect(result).not.toContain("1. —");
  });
});
