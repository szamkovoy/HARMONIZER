import { describe, expect, it } from "vitest";

import type { AppContentLocale } from "@legacy/app/api/_utils/contentLocales";
import { looksLikeNewPlannedAction } from "@legacy/app/api/_utils/planningDonePhrases";
import type { MessageRecord } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";
import { initFsmState } from "./dialogFsm";
import {
  assistantAskedPlanningClosure,
  assistantFinalizeWithoutMarkers,
  assistantOfferedPractice,
  assistantAskedSummaryClarifyingQuestion,
  assistantVisibleContainsSummaryClarifyingCue,
  coerceFsmBeforeTurn,
  collectPlanningBranchUserHistory,
  extractPlanningMarkersFromVisibleFinalize,
  filterPersistablePlanningMarkers,
  filterPracticeLikePlannedEvents,
  inferPlanningSpheresFromText,
  isPracticeLikePlannedEventDesc,
  mergeHistoryPlanningMarkers,
  mergePlanningMarkersWithVisibleFinalize,
  resolveAddFlowPlanningMarkers,
  userAffirmsPracticeOffer,
  buildSummaryClarifyingQuestion,
  buildSummaryEventDidNotHappenBridge,
  summaryVisibleTextMixesMultipleEvents,
  userAnswerHasSufficientStateForSummary,
  userAnswerIsThinForSummary,
  userSaysEventDidNotHappen,
  userSignalsPlanningDone,
} from "./dialogTurnGuards";

const ALL_RECOMMENDATION_LABELS: Array<{ locale: AppContentLocale; label: string }> = [
  { locale: "ru", label: "Рекомендация" },
  { locale: "en", label: "Recommendation" },
  { locale: "de", label: "Empfehlung" },
  { locale: "fr", label: "Recommandation" },
  { locale: "it", label: "Raccomandazione" },
  { locale: "es", label: "Recomendación" },
  { locale: "pt", label: "Recomendação" },
  { locale: "nl", label: "Aanbeveling" },
];

function assistantMsg(content: string): MessageRecord {
  return { id: "m", role: "assistant", content, transcript: null, meta: null, created_at: null };
}

describe("dialogTurnGuards", () => {
  it("detects planning done signals", () => {
    expect(userSignalsPlanningDone("Думаю, достаточно этого.")).toBe(true);
    expect(userSignalsPlanningDone("Questo è sufficiente.")).toBe(true);
    expect(userSignalsPlanningDone("Non c'è più niente da aggiungere.")).toBe(true);
    expect(userSignalsPlanningDone("Non voglio affrontare niente.")).toBe(true);
    expect(userSignalsPlanningDone("Non voglio aggiungere più niente.")).toBe(true);
    expect(userSignalsPlanningDone("Non voglio aggiungere piu niente.")).toBe(true);
    expect(userSignalsPlanningDone("Niente da affrontare.")).toBe(true);
    expect(userSignalsPlanningDone("No, non aggiungi più niente.")).toBe(true);
    expect(userSignalsPlanningDone("Sì, possiamo finire.")).toBe(true);
    expect(userSignalsPlanningDone("Niente più.")).toBe(true);
    expect(userSignalsPlanningDone("Niente piu")).toBe(true);
    expect(userSignalsPlanningDone("NONO")).toBe(true);
    expect(userSignalsPlanningDone("Ничего планировать не хочу.")).toBe(true);
    expect(userSignalsPlanningDone("Не хочу ничего планировать")).toBe(true);
    expect(userSignalsPlanningDone("Планировать не хочу")).toBe(true);
    expect(userSignalsPlanningDone("Nothing to plan today")).toBe(true);
    expect(userSignalsPlanningDone("ещё прогулка")).toBe(false);
    expect(
      userSignalsPlanningDone(
        "Сегодня я все-таки хочу съездить в магазин, посмотреть лодки, а потом сходить в кино.",
      ),
    ).toBe(false);
    // Named action + trailing «больше ничего» = finalize WITH the action (not empty plan).
    expect(
      userSignalsPlanningDone("Снова хотел бы посмотреть хороший фильм. И больше ничего."),
    ).toBe(true);
    expect(
      userSignalsPlanningDone("I want to watch a movie. And nothing else."),
    ).toBe(true);
  });

  it("keeps a named action when the same turn also says nothing else", () => {
    expect(
      looksLikeNewPlannedAction("Снова хотел бы посмотреть хороший фильм. И больше ничего."),
    ).toBe(true);
    expect(looksLikeNewPlannedAction("И больше ничего.")).toBe(false);
  });

  it("does not persist empty-plan refusals as planned actions", () => {
    const filtered = filterPersistablePlanningMarkers([
      { desc: "Ничего планировать не хочу", time: null, timeNorm: null, recommendation: null, displayOrder: 1, cells: [], snippets: [] },
      { desc: "Прогулка в парке", time: null, timeNorm: null, recommendation: "спокойно", displayOrder: 2, cells: [], snippets: [] },
    ]);
    expect(filtered.map((marker) => marker.desc)).toEqual(["Прогулка в парке"]);
  });

  it("does not persist meta «добавить действие про…» as a planned action", () => {
    const filtered = filterPersistablePlanningMarkers([
      {
        desc: ", я решил добавить действие про отдых",
        time: null,
        timeNorm: null,
        recommendation: null,
        displayOrder: 1,
        cells: [],
        snippets: [],
      },
      {
        desc: "Встречусь с друзьями в кафе",
        time: null,
        timeNorm: null,
        recommendation: "слушайте собеседников",
        displayOrder: 2,
        cells: [],
        snippets: [],
      },
    ]);
    expect(filtered.map((marker) => marker.desc)).toEqual(["Встречусь с друзьями в кафе"]);
  });

  it("add-flow drops past-tense «подумал… из сферы» scaffolding", () => {
    const filtered = filterPersistablePlanningMarkers(
      [
        {
          desc: "Подумал, что стоит добавить что-нибудь из сферы отдыха",
          time: null,
          timeNorm: null,
          recommendation: null,
          displayOrder: 1,
          cells: [],
          snippets: [],
        },
        {
          desc: "Вкусный торт вечером",
          time: null,
          timeNorm: null,
          recommendation: "ешьте осознанно",
          displayOrder: 2,
          cells: [],
          snippets: [],
        },
      ],
      { addFlow: true },
    );
    expect(filtered.map((marker) => marker.desc)).toEqual(["Вкусный торт вечером"]);
  });

  it("add-flow trusts model markers over keyword-invented scaffolding", () => {
    const resolved = resolveAddFlowPlanningMarkers({
      existingConversationMarkers: [
        {
          desc: "Пойти в оперу",
          time: null,
          timeNorm: null,
          recommendation: null,
          displayOrder: 1,
          cells: [{ sphere: 5, weight: 1 }],
          snippets: [],
        },
      ],
      modelMarkers: [
        {
          desc: "Почитать книгу о главных моментах",
          time: null,
          timeNorm: null,
          recommendation: null,
          displayOrder: 2,
          cells: [{ sphere: 6, weight: 1 }],
          snippets: [],
        },
      ],
    });
    expect(resolved.map((marker) => marker.desc)).toEqual([
      "Пойти в оперу",
      "Почитать книгу о главных моментах",
    ]);
  });

  it("add-flow salvage backfills recommendations without inventing extra cards", () => {
    const merged = mergePlanningMarkersWithVisibleFinalize(
      [
        {
          desc: "Пойти в оперу",
          time: null,
          timeNorm: null,
          recommendation: null,
          displayOrder: 1,
          cells: [],
          snippets: [],
        },
        {
          desc: "Почитать книгу про главные моменты",
          time: null,
          timeNorm: null,
          recommendation: null,
          displayOrder: 2,
          cells: [],
          snippets: [],
        },
      ],
      [
        {
          desc: "Самые интересные действия нужно совершать сразу",
          time: null,
          timeNorm: null,
          recommendation: null,
          displayOrder: 1,
          cells: [],
          snippets: [],
        },
        {
          desc: "Пойти в оперу",
          time: null,
          timeNorm: null,
          recommendation: "Настройтесь на восприятие.",
          displayOrder: 2,
          cells: [],
          snippets: [],
        },
        {
          desc: "Почитать книгу про главные моменты",
          time: null,
          timeNorm: null,
          recommendation: "Сформулируйте мысль своими словами.",
          displayOrder: 3,
          cells: [],
          snippets: [],
        },
      ],
      { allowSalvageOnlyAdditions: false },
    );
    expect(merged.map((marker) => marker.desc)).toEqual([
      "Пойти в оперу",
      "Почитать книгу про главные моменты",
    ]);
    expect(merged[0]?.recommendation).toMatch(/восприятие/i);
    expect(merged[1]?.recommendation).toMatch(/своими словами/i);
  });

  it("coerces practice after empty-plan practice offer without numbered wrap-up", () => {
    const fsm = initFsmState({
      tabMode: "plan",
      daySummaryRequested: false,
      hasDueEvents: false,
      targetChakra: 2,
      workingLocalDate: "2026-07-11",
    });
    const planningFsm = {
      ...fsm,
      branch: "planning" as const,
      branchIndex: fsm.flow.indexOf("planning"),
      planningFinalized: false,
    };
    const history = [
      assistantMsg(
        "Хорошо, без плана так без плана. Тогда день сам собой сложится.\n\nХотите сейчас небольшую практику? Если да, скажите, какую — медитацию, дыхание или асаны, и сколько по времени примерно.",
      ),
    ];
    const next = coerceFsmBeforeTurn({
      fsm: planningFsm,
      history,
      userMessage: "Да, одну минуту медитации я бы выполнил.",
      isInitiate: false,
    });
    expect(next.branch).toBe("practice");
    expect(next.planningFinalized).toBe(true);
  });

  it("uses the assistant close-question context for add-flow finish replies", () => {
    const history = [
      assistantMsg("Vuoi aggiungere altro o ti va di chiudere qua il piano?"),
    ];
    expect(assistantAskedPlanningClosure(history)).toBe(true);
    expect(userSignalsPlanningDone("Sì, possiamo finire.", history)).toBe(true);
    expect(userSignalsPlanningDone("No, non aggiungi più niente.", history)).toBe(true);
    expect(userSignalsPlanningDone("Niente più.", history)).toBe(true);
    expect(userSignalsPlanningDone("Non voglio aggiungere più niente.", history)).toBe(true);
    expect(userSignalsPlanningDone("Sì, aggiungo ancora una cosa.", history)).toBe(false);
  });

  it("treats unseen decline phrasing as closure when answering an add-more question", () => {
    const history = [
      assistantMsg("C'è altro che vuoi aggiungere al piano per oggi?"),
    ];
    expect(userSignalsPlanningDone("No grazie, per oggi basta così.", history)).toBe(true);
    expect(userSignalsPlanningDone("Anche una riunione alle tre.", history)).toBe(false);
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

  it("filters planning-done closure phrases from persistable markers", () => {
    const filtered = filterPersistablePlanningMarkers([
      { desc: "Lavoro", recommendation: "a", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
      { desc: "Non voglio aggiungere più niente", recommendation: "b", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
      { desc: "Cinema stasera", recommendation: "c", displayOrder: 2, time: null, timeNorm: null, cells: [], snippets: [] },
    ]);
    expect(filtered.map((marker) => marker.desc)).toEqual(["Lavoro", "Cinema stasera"]);
  });

  it("drops visible markers that echo the user's closure reply", () => {
    const filtered = filterPersistablePlanningMarkers(
      [
        { desc: "Lavoro", recommendation: "a", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
        { desc: "Non voglio aggiungere più niente", recommendation: "b", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
      ],
      { closureUserMessage: "Non voglio aggiungere più niente." },
    );
    expect(filtered.map((marker) => marker.desc)).toEqual(["Lavoro"]);
  });

  it("drops incremental planning blobs when shorter sibling markers exist", () => {
    const filtered = filterPersistablePlanningMarkers([
      {
        desc: "Oggi è sabato, quindi voglio divertirmi, viaggiare al lago, viaggiare, dipingere, mangiare il salsiccio",
        recommendation: "",
        displayOrder: 1,
        time: null,
        timeNorm: null,
        cells: [],
        snippets: [],
      },
      {
        desc: "Gita al lago",
        recommendation: "",
        displayOrder: 1,
        time: null,
        timeNorm: null,
        cells: [],
        snippets: [],
      },
      {
        desc: "Film e dormire",
        recommendation: "",
        displayOrder: 4,
        time: null,
        timeNorm: null,
        cells: [],
        snippets: [],
      },
    ]);
    expect(filtered.map((marker) => marker.desc)).toEqual(["Gita al lago", "Film e dormire"]);
  });

  it("keeps a single long planning label when no shorter sibling exists", () => {
    const longDesc = "Подготовить презентацию для совещания с руководством и собрать все материалы";
    const filtered = filterPersistablePlanningMarkers([
      {
        desc: longDesc,
        recommendation: "",
        displayOrder: 1,
        time: null,
        timeNorm: null,
        cells: [],
        snippets: [],
      },
    ]);
    expect(filtered.map((marker) => marker.desc)).toEqual([longDesc]);
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

  it("collects only planning-branch user turns from mixed history", () => {
    const history: MessageRecord[] = [
      {
        id: "a1",
        role: "assistant",
        content: "Как прошёл вчерашний день?",
        transcript: null,
        meta: { dialog_branches: ["summarizing"] },
        created_at: null,
      },
      { id: "u1", role: "user", content: "Я поработал и сходил в магазин.", transcript: null, meta: null, created_at: null },
      {
        id: "a2",
        role: "assistant",
        content: "Что вы хотите запланировать?",
        transcript: null,
        meta: { branches: ["planning"] },
        created_at: null,
      },
      { id: "u2", role: "user", content: "Посмотреть лодку в магазине.", transcript: null, meta: null, created_at: null },
      {
        id: "a3",
        role: "assistant",
        content: "Что ещё добавить?",
        transcript: null,
        meta: { dialog_branches: ["planning"] },
        created_at: null,
      },
      { id: "u3", role: "user", content: "Почитать книгу перед сном.", transcript: null, meta: null, created_at: null },
    ];
    expect(collectPlanningBranchUserHistory(history)).toEqual([
      { role: "user", content: "Посмотреть лодку в магазине." },
      { role: "user", content: "Почитать книгу перед сном." },
    ]);
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
    expect(userAnswerIsThinForSummary("Да, книгу прочитал.")).toBe(true);
    expect(userAnswerHasSufficientStateForSummary(
      "Да, посетил, посмотрел закат, получил массу положительных эмоций. Это красиво.",
    )).toBe(true);
    expect(userAnswerIsThinForSummary(
      "Да, посетил, посмотрел закат, получил массу положительных эмоций. Это красиво.",
    )).toBe(false);
    expect(userAnswerHasSufficientStateForSummary(
      "Да, книгу почитал и это был роман, заставил меня задуматься о жизни, о смыслах",
    )).toBe(true);
    expect(userAnswerIsThinForSummary(
      "Да, книгу почитал и это был роман, заставил меня задуматься о жизни, о смыслах",
    )).toBe(false);
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

    // Creative clarifiers contrast lived domains — not three near-synonyms of one chakra.
    const bookQuestion = buildSummaryClarifyingQuestion("Почитать книгу перед сном", "ru");
    expect(bookQuestion).not.toMatch(/спокойствие,\s*интерес,\s*или\s*ощущение\s*смысла/i);
    expect(/удовольств|задума|размышл/i.test(bookQuestion)).toBe(true);

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
    expect(assistantVisibleContainsSummaryClarifyingCue(
      "Hai avuto la sensazione di essere focalizzata e precisa, o c'è stato qualche momento di tensione?",
    )).toBe(true);
  });

  it("detects mixed summary turns structurally", () => {
    const mixed = [
      "Bene, un carico di cose da fare. Hai avuto la sensazione di essere focalizzata e precisa, o c'è stato qualche momento di tensione e spinta per portare tutto a termine?",
      "",
      "E per andare in negozio per la barca, com'è andata?",
    ].join("\n");
    expect(summaryVisibleTextMixesMultipleEvents(
      mixed,
      "Lavorare sulle attività lavorative",
      "Andare in negozio per la barca",
    )).toBe(true);
    expect(assistantVisibleContainsSummaryClarifyingCue(mixed)).toBe(true);
    expect(summaryVisibleTextMixesMultipleEvents(
      "Capito. E il cinema? Sei riuscita ad andare?",
      "Andare in negozio per la barca",
      "Andare al cinema",
    )).toBe(false);
  });

  it("treats thin Italian summary answers like other locales", () => {
    expect(userAnswerIsThinForSummary(
      "Ho avuto molte cose da fare oggi. L'obiettivo è fare molte cose, ma bisogna fare le cose in modo corretto.",
    )).toBe(false);
    expect(userAnswerIsThinForSummary(
      "Lo che ho sentito è responsabilità e tensione intellettuale, perché la mia domanda era complicata.",
    )).toBe(false);
  });

  it("detects Italian non-occurrence and sufficient lived-state answers", () => {
    expect(userSaysEventDidNotHappen("Non ho letto il libro, non ne ho avuto il tempo.")).toBe(true);
    expect(userAnswerHasSufficientStateForSummary("Mi è piaciuto molto, mi sono sentito più leggero e soddisfatto.")).toBe(true);
    expect(userAnswerIsThinForSummary("Sono stato stanco, ma ho sentito anche soddisfazione e un senso di buon lavoro.")).toBe(false);
  });

  it("treats cross-locale non-occurrence and lived-state answers as shared logic", () => {
    const cases = [
      {
        no: "I didn't read it and ran out of time.",
        enough: "I felt calm, lighter, and genuinely satisfied.",
      },
      {
        no: "Je ne l'ai pas fait, je n'ai pas eu le temps.",
        enough: "Je me suis senti calme, soulagé et satisfait.",
      },
      {
        no: "Ich habe es nicht geschafft, ich hatte keine Zeit.",
        enough: "Ich habe mich ruhig, klar und erleichtert gefühlt.",
      },
      {
        no: "No lo hice, no tuve tiempo.",
        enough: "Me sentí tranquilo, más ligero y satisfecho.",
      },
      {
        no: "Não fiz isso, não tive tempo.",
        enough: "Me senti calmo, mais leve e satisfeito.",
      },
      {
        no: "Ik heb het niet gedaan, ik had geen tijd.",
        enough: "Ik voelde me rustig, lichter en tevreden.",
      },
    ];

    for (const sample of cases) {
      expect(userSaysEventDidNotHappen(sample.no), sample.no).toBe(true);
      expect(userAnswerHasSufficientStateForSummary(sample.enough), sample.enough).toBe(true);
      expect(userAnswerIsThinForSummary(sample.enough), sample.enough).toBe(false);
    }
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

  it("salvages French visible planning markers when the label uses typography spacing", () => {
    const text = [
      "Aujourd'hui, le troisieme chakra est au premier plan.",
      "",
      "1. Aller au magasin voir un bateau",
      "Recommandation : Comparez calmement sans vous precipiter.",
      "",
      "2. Beaucoup travailler",
      "Recommandation : Gardez une ligne claire et des priorites simples.",
      "",
      "3. Regarder un film le soir",
      "Recommandation : Laissez-le devenir un vrai temps de decompression.",
      "",
      "Souhaitez-vous faire une pratique maintenant ?",
    ].join("\n");
    const salvaged = extractPlanningMarkersFromVisibleFinalize(text, "fr");
    expect(salvaged).toHaveLength(3);
    expect(salvaged.map((item) => item.desc)).toEqual([
      "Aller au magasin voir un bateau",
      "Beaucoup travailler",
      "Regarder un film le soir",
    ]);
    expect(salvaged[0]?.recommendation).toBe("Comparez calmement sans vous precipiter.");
  });

  it("salvages visible planning markers even when the model leaks the English label in another locale", () => {
    const text = [
      "Perfetto, abbiamo tutto.",
      "",
      "1. Raffinatura",
      "Recommendation: Portala con la stessa determinazione con cui hai deciso di farla.",
      "",
      "2. Teatro a notte",
      "Recommendation: Entra in sala da protagonista, non da spettatore.",
    ].join("\n");
    const salvaged = extractPlanningMarkersFromVisibleFinalize(text, "it");
    expect(salvaged).toHaveLength(2);
    expect(salvaged[0]?.desc).toBe("Raffinatura");
    expect(salvaged[0]?.recommendation).toContain("stessa determinazione");
    expect(salvaged[1]?.desc).toBe("Teatro a notte");
  });

  it("salvages visible planning markers across all scaffold locales", () => {
    for (const { locale, label } of ALL_RECOMMENDATION_LABELS) {
      const text = [
        "Plan du jour:",
        "",
        "1) First action",
        `${label} : Keep it steady.`,
        "",
        "2. Second action",
        `${label}: Stay focused.`,
        "",
        "Practice question here?",
      ].join("\n");
      const salvaged = extractPlanningMarkersFromVisibleFinalize(text, locale);
      expect(salvaged, `locale=${locale}`).toHaveLength(2);
      expect(salvaged.map((item) => item.desc), `locale=${locale}`).toEqual([
        "First action",
        "Second action",
      ]);
      expect(salvaged[0]?.recommendation, `locale=${locale}`).toBe("Keep it steady.");
      expect(salvaged[1]?.recommendation, `locale=${locale}`).toBe("Stay focused.");
    }
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

  it("does not treat родник as family (родн is not a substring match)", () => {
    expect(inferPlanningSpheresFromText("поехать на родник").some((cell) => cell.sphere === 4)).toBe(false);
  });

  it("still maps родные/family words to sphere 4", () => {
    expect(inferPlanningSpheresFromText("навестить родных").some((cell) => cell.sphere === 4)).toBe(true);
    expect(inferPlanningSpheresFromText("встреча с родными").some((cell) => cell.sphere === 4)).toBe(true);
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

  it("prefers target-locale markers by display order instead of duplicating translated history items", () => {
    const merged = mergeHistoryPlanningMarkers(
      [
        {
          desc: "Все-таки хочу съездить в магазин, посмотреть лодки",
          recommendation: null,
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 1, weight: 1 }],
          snippets: [],
        },
        {
          desc: "Далее хочу сходить в кино",
          recommendation: null,
          displayOrder: 2,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 5, weight: 1 }],
          snippets: [],
        },
        {
          desc: "Но до этого в течение дня нужно очень хорошо поработать",
          recommendation: null,
          displayOrder: 3,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 3, weight: 1 }],
          snippets: [],
        },
      ],
      [
        {
          desc: "Andare in negozio per la barca",
          recommendation: "Confronta le opzioni con calma.",
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 2, weight: 0.6 }, { sphere: 3, weight: 0.4 }],
          snippets: [],
        },
        {
          desc: "Andare al cinema",
          recommendation: "Lascia che diventi un vero cambio di ritmo.",
          displayOrder: 2,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 5, weight: 1 }],
          snippets: [],
        },
        {
          desc: "Lavorare sulle attività lavorative",
          recommendation: "Tieni una linea chiara nelle priorità.",
          displayOrder: 3,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 3, weight: 1 }],
          snippets: [],
        },
      ],
      { preferCurrentByDisplayOrder: true },
    );

    expect(merged).toHaveLength(3);
    expect(merged.map((item) => item.desc)).toEqual([
      "Andare in negozio per la barca",
      "Andare al cinema",
      "Lavorare sulle attività lavorative",
    ]);
    expect(merged.every((item) => item.recommendation)).toBe(true);
  });

  it("backfills translated visible-final recommendations by display order without doubling items", () => {
    const merged = mergePlanningMarkersWithVisibleFinalize(
      [
        {
          desc: "Все-таки хочу съездить в магазин, посмотреть лодки",
          recommendation: null,
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 1, weight: 1 }],
          snippets: [],
        },
        {
          desc: "Далее хочу сходить в кино",
          recommendation: null,
          displayOrder: 2,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 5, weight: 1 }],
          snippets: [],
        },
      ],
      [
        {
          desc: "Andare in negozio per la barca",
          recommendation: "Confronta le opzioni con calma.",
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 2, weight: 0.6 }, { sphere: 3, weight: 0.4 }],
          snippets: [],
        },
        {
          desc: "Andare al cinema",
          recommendation: "Lascia che diventi un vero cambio di ritmo.",
          displayOrder: 2,
          time: null,
          timeNorm: null,
          cells: [{ sphere: 5, weight: 1 }],
          snippets: [],
        },
      ],
      { preferCurrentByDisplayOrder: true },
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.desc)).toEqual([
      "Andare in negozio per la barca",
      "Andare al cinema",
    ]);
    expect(merged.map((item) => item.recommendation)).toEqual([
      "Confronta le opzioni con calma.",
      "Lascia che diventi un vero cambio di ritmo.",
    ]);
  });
});
