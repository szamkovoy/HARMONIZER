import { describe, expect, it } from "vitest";

import {
  buildPlanningAddFinalVisibleText,
  buildPlanningPrompt,
  buildPlanningFinalVisibleText,
  buildSummarizingPrompt,
  capitalizeFirstLetter,
  extractDayFocusFromVisibleFinalize,
  injectPlanningActionsVisibleList,
  injectPlanningDayFocus,
  polishPlanningMarker,
  prependChakraAttention,
  replaceSpontaneousEnglishRu,
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
  targetChakraGenitive: "4",
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

describe("extractDayFocusFromVisibleFinalize", () => {
  it("salvages the day recommendation paragraph before the numbered list", () => {
    const text = [
      "Договорились. Тогда подведу итог вашему дню.",
      "",
      "Сегодня наибольшим потенциалом обладает седьмая чакра: именно сейчас стоит действовать не по привычке, а из состояния тихого доверия к большему, и тогда даже бытовые дела раскроют новый смысл.",
      "",
      "1. Выбрать саженцы яблони",
      "Рекомендация: выбирайте неспешно.",
      "",
      "2. Почитать книгу перед сном",
      "Рекомендация: читайте без спешки.",
    ].join("\n");
    const result = extractDayFocusFromVisibleFinalize(text, 2);
    expect(result).toContain("седьмая чакра");
    expect(result).not.toContain("Выбрать саженцы");
    expect(result).not.toMatch(/Договорились/);
  });

  it("returns empty string when there is no substantial recommendation", () => {
    const text = ["Хорошо. Что-то ещё важное на сегодня?"].join("\n");
    expect(extractDayFocusFromVisibleFinalize(text, 1)).toBe("");
  });

  it("salvages a French day-focus paragraph before the numbered list", () => {
    const text = [
      "D'accord, je note tout ça.",
      "",
      "Aujourd'hui, le troisième chakra passe au premier plan : c'est une bonne journée pour choisir clairement ce que vous faites et avancer avec plus de décision tranquille, sans vous disperser.",
      "",
      "1. Acheter un bateau pneumatique avec moteur",
      "Recommendation: Prenez le temps de comparer calmement.",
      "",
      "2. Lire un livre avant de dormir",
      "Recommendation: Choisissez un passage qui compte pour vous.",
    ].join("\n");
    const result = extractDayFocusFromVisibleFinalize(text, 2);
    expect(result).toContain("troisième chakra");
    expect(result).not.toContain("Acheter un bateau");
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
  it("reminds the model not to mirror input language when it differs from the reply locale", () => {
    const { systemInstruction } = buildPlanningPrompt(
      { ...brainCtx, locale: "fr", languageName: "French", inputLanguageName: "Russian" },
      {
        isOpening: true,
        noPractice: false,
        noGreeting: false,
        userSignaledDone: false,
        planningLocked: false,
        existingActionCount: 0,
      },
    );
    expect(systemInstruction).toContain("speak or type in Russian");
    expect(systemInstruction).toContain("entirely in French");
  });

  it("frames day focus as recommendation, not forecast", () => {
    const { userInstruction } = buildPlanningPrompt(brainCtx, {
      isOpening: false,
      noPractice: false,
      noGreeting: false,
      userSignaledDone: true,
      planningLocked: false,
      existingActionCount: 0,
    });
    expect(userInstruction).toMatch(/as a living recommendation/i);
    // Visible day-recommendation paragraph and short_text must be the SAME text.
    expect(userInstruction).toMatch(/MUST be the SAME text/i);
    // The model itself names the chakra by number, and keeps the paragraph compact.
    expect(userInstruction).toMatch(/Name the day's chakra BY NUMBER/i);
    expect(userInstruction).toMatch(/150[–-]230 characters/i);
    expect(userInstruction).toMatch(/polite suggestions/i);
  });

  it("forbids day-focus markers in Day tab add flow", () => {
    const { userInstruction } = buildPlanningPrompt(brainCtx, {
      isOpening: false,
      noPractice: true,
      noGreeting: true,
      userSignaledDone: true,
      planningLocked: false,
      existingActionCount: 0,
    });
    expect(userInstruction).toMatch(/NEVER emit \[CORRECT_RECOMMENDATION\]/i);
    expect(userInstruction).toMatch(/only PLANNED_EVENT markers are allowed/i);
  });

  it("acknowledges an already-planned day in the add-flow opening", () => {
    const { userInstruction } = buildPlanningPrompt(brainCtx, {
      isOpening: true,
      noPractice: true,
      noGreeting: true,
      userSignaledDone: false,
      planningLocked: false,
      existingActionCount: 2,
    });
    expect(userInstruction).toMatch(/ALREADY has 2 planned action/i);
    expect(userInstruction).toMatch(/what they would like to ADD/i);
    expect(userInstruction).toMatch(/Vary the wording/i);
  });

  it("falls back to the plain add-flow opening when the day has no actions yet", () => {
    const { userInstruction } = buildPlanningPrompt(brainCtx, {
      isOpening: true,
      noPractice: true,
      noGreeting: true,
      userSignaledDone: false,
      planningLocked: false,
      existingActionCount: 0,
    });
    expect(userInstruction).toMatch(/adding action\(s\) from the Day tab/i);
  });

  it("includes the life-spheres guide and an anti-parrot spheres rule", () => {
    const { userInstruction } = buildPlanningPrompt(brainCtx, {
      isOpening: false,
      noPractice: false,
      noGreeting: false,
      userSignaledDone: true,
      planningLocked: false,
      existingActionCount: 0,
    });
    expect(userInstruction).toMatch(/do NOT copy the format example numbers/i);
    expect(userInstruction).toMatch(/Sphere 4 is ONLY for actions/i);
    expect(userInstruction).not.toContain('spheres="1:0.6;4:0.4"');
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

  it("drops an intro with the wrong action count", () => {
    const result = buildPlanningFinalVisibleText({
      visibleText: [
        "Хорошо, тогда три главные вещи на сегодня.",
        "",
        "1. Магазин",
        "Рекомендация: Сохраняйте ясность.",
      ].join("\n"),
      dayFocus: "Проживите дела дня с ясностью и внутренней опорой.",
      locale: "ru",
      includePracticeQuestion: false,
      events: [
        { desc: "Магазин", recommendation: "Сохраняйте ясность.", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
        { desc: "Свидание", recommendation: "Будьте внимательны к контакту.", displayOrder: 2, time: null, timeNorm: null, cells: [], snippets: [] },
      ],
    });

    expect(result).not.toContain("три главные");
    expect(result).toContain("Проживите дела дня");
    expect(result).toContain("2. Свидание");
  });

  it("uses the locale-native recommendation label in French", () => {
    const result = buildPlanningFinalVisibleText({
      visibleText: [
        "D'accord, je note tout ça.",
        "",
        "Aujourd'hui, le troisième chakra passe au premier plan : choisissez clairement ce qui compte et avancez avec plus de décision tranquille.",
        "",
        "1. Acheter un bateau pneumatique avec moteur",
        "Recommendation: Prenez le temps de comparer calmement.",
      ].join("\n"),
      dayFocus:
        "Aujourd'hui, le troisième chakra passe au premier plan : choisissez clairement ce qui compte et avancez avec plus de décision tranquille.",
      locale: "fr",
      includePracticeQuestion: false,
      events: [
        {
          desc: "Acheter un bateau pneumatique avec moteur",
          recommendation: "Prenez le temps de comparer calmement.",
          displayOrder: 1,
          time: null,
          timeNorm: null,
          cells: [],
          snippets: [],
        },
      ],
    });
    expect(result).toContain("Recommandation: Prenez le temps de comparer calmement.");
    expect(result).not.toContain("Recommendation:");
  });

  it("uses a substantial short_text (dayFocus) verbatim as the intro, ignoring the model's free intro", () => {
    // The Day-tab header stores short_text; the visible final intro must be the
    // SAME text so they never diverge in length or wording.
    const shortText =
      "Седьмая чакра приглашает прожить вечер чуть осознаннее: заметьте за обычным ужином тепло близких и тихий смысл, удержите это присутствие — оно делает день цельнее.";
    const result = buildPlanningFinalVisibleText({
      visibleText: [
        "Совсем другой, более длинный и не такой текст вступления, который модель написала отдельно от маркера и который не должен попасть в финал вместо short_text.",
        "",
        "1. Ужин с друзьями",
        "Рекомендация: Замечайте лица и тепло.",
      ].join("\n"),
      dayFocus: shortText,
      locale: "ru",
      includePracticeQuestion: false,
      events: [
        { desc: "Ужин с друзьями", recommendation: "Замечайте лица и тепло.", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
      ],
    });
    expect(result.startsWith(shortText)).toBe(true);
    expect(result).not.toContain("более длинный и не такой текст");
  });

  it("builds add-flow final only from accepted marker-backed actions", () => {
    const result = buildPlanningAddFinalVisibleText({
      locale: "ru",
      events: [
        { desc: "Вкусный ужин в ресторане", recommendation: "Замечайте вкус и атмосферу.", displayOrder: 4, time: null, timeNorm: null, cells: [], snippets: [] },
        { desc: "Урок танцев", recommendation: "Следуйте музыке без самокритики.", displayOrder: 5, time: null, timeNorm: null, cells: [], snippets: [] },
      ],
    });

    expect(result).toContain("два дела");
    expect(result).toContain("Вкусный ужин в ресторане");
    expect(result).toContain("Урок танцев");
    expect(result).not.toContain("высших смыслов");
  });
});

describe("replaceSpontaneousEnglishRu", () => {
  it("replaces stray English wellness words with Russian equivalents", () => {
    expect(replaceSpontaneousEnglishRu("Пусть даже самый рутинный task коснётся смысла.")).toContain("задача");
    expect(replaceSpontaneousEnglishRu("Пусть ответ quietly присутствует фоном.")).toContain("тихо");
    expect(replaceSpontaneousEnglishRu("Пусть ответ quietly присутствует фоном.")).not.toMatch(/quietly/i);
  });
  it("preserves leading capitalization of the replaced word", () => {
    expect(replaceSpontaneousEnglishRu("Flow дня важен.")).toBe("Поток дня важен.");
  });
  it("capitalizes the first letter of a title without touching the rest", () => {
    expect(capitalizeFirstLetter("пойти в кино вечером")).toBe("Пойти в кино вечером");
    expect(capitalizeFirstLetter("Уже с заглавной")).toBe("Уже с заглавной");
    expect(capitalizeFirstLetter("go to the gym")).toBe("Go to the gym");
    expect(capitalizeFirstLetter("")).toBe("");
  });
  it("polishPlanningMarker capitalizes the action title and the recommendation", () => {
    const polished = polishPlanningMarker(
      {
        desc: "пойти в кино вечером",
        recommendation: "занимаясь каждой задачей, остановитесь на минуту.",
        displayOrder: 1,
        time: null,
        timeNorm: null,
        cells: [],
        snippets: [],
      },
      "ru",
    );
    expect(polished.desc).toBe("Пойти в кино вечером");
    // Recommendation text in the Day tab must start with a capital letter.
    expect(polished.recommendation?.startsWith("Занимаясь")).toBe(true);
  });
  it("does not touch unknown Latin tokens (possible user terms)", () => {
    expect(replaceSpontaneousEnglishRu("Сегодня пишу запросы на SQL.")).toBe("Сегодня пишу запросы на SQL.");
  });
});

describe("prependChakraAttention", () => {
  it("prepends a numeric chakra attention phrase in accusative", () => {
    expect(prependChakraAttention("Заметьте большее за суетой.", 7, "ru")).toBe(
      "Внимание на седьмую чакру. Заметьте большее за суетой.",
    );
  });
  it("is idempotent when the phrase is already present", () => {
    const once = prependChakraAttention("Заметьте большее.", 6, "ru");
    expect(prependChakraAttention(once, 6, "ru")).toBe(once);
  });
  it("uses ordinals for the English locale", () => {
    expect(prependChakraAttention("Notice the bigger picture.", 4, "en")).toBe(
      "Attention on the fourth chakra. Notice the bigger picture.",
    );
  });
});

describe("buildPlanningFinalVisibleText with chakra prefix", () => {
  it("adds the chakra attention phrase to the day-focus paragraph", () => {
    const result = buildPlanningFinalVisibleText({
      visibleText: "Сегодня держите ясность.\n\n1. Работа\nРекомендация: Видьте целое.",
      dayFocus: "Сегодня держите ясность.",
      locale: "ru",
      includePracticeQuestion: false,
      targetChakraNumber: 6,
      events: [
        { desc: "Работа", recommendation: "Видьте целое.", displayOrder: 1, time: null, timeNorm: null, cells: [], snippets: [] },
      ],
    });
    expect(result.startsWith("Внимание на шестую чакру.")).toBe(true);
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
