import { describe, expect, it } from "vitest";
import {
  buildCatalogReconciliationInstruction,
  parseResponseMarkers,
  sanitizeAssistantText,
  stripDialogScaffoldMarkdown,
  userAnsweredPracticeRequest,
  userDeclinedPracticeInHistory,
  validateHistoryHasDurationAndType,
} from "./markers";

describe("stripDialogScaffoldMarkdown", () => {
  it("removes horizontal rules and entire **…** blocks (not unwrapping)", () => {
    const raw =
      "---\n\n**Зеркало**\n\nТекст зеркала.\n\n**Темы**\n\nДальше.\n\nШея (то, о чём вы упомянули через боль) и плечи.";
    const out = stripDialogScaffoldMarkdown(raw);
    expect(out).toBe("Текст зеркала.\n\nДальше.\n\nШея (то, о чём вы упомянули через боль) и плечи.");
  });

  it("removes long **…** section titles", () => {
    const raw = "**Главная тема через призму чакры дня**\n\nАбзац.\n\n**Штрих глубины**\n\nКонец.";
    expect(stripDialogScaffoldMarkdown(raw)).toBe("Абзац.\n\nКонец.");
  });
});

describe("sanitizeAssistantText", () => {
  it("removes leaked hint markers from Russian assistant text", () => {
    const raw = `Не понял. Допустим, в голове отзывается. Что дальше?\n\n(Saturn/Voice hint), или, может, просто тихая нехватка ясности? Наговорите`;

    expect(sanitizeAssistantText(raw, "ru")).toBe(
      "Не понял. Допустим, в голове отзывается. Что дальше?\n\nили, может, просто тихая нехватка ясности? Наговорите",
    );
  });

  it("removes stray English gloss lines from Russian assistant text", () => {
    const raw = `прячется много шума, заметили?"\n(Sometimes behind silence hides a lot of noise, noticed?)\n* Call`;

    expect(sanitizeAssistantText(raw, "ru")).toBe(`прячется много шума, заметили?"`);
  });

  it("removes markdown scaffold: --- and entire **…** blocks", () => {
    const raw = "---\n\n**Зеркало**\n\nАбзац.\n\n**Темы**\n\nЕщё.";
    const out = sanitizeAssistantText(raw, "ru");
    expect(out).not.toContain("---");
    expect(out).not.toContain("**");
    expect(out).not.toContain("Зеркало");
    expect(out).toContain("Абзац");
  });
});

describe("validateHistoryHasDurationAndType", () => {
  it("parses «три четверти часа» as 45 minutes, not three hours", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "У меня три четверти часа, хочу асаны" },
    ]);
    expect(result.durationSec).toBe(45 * 60);
  });

  it("recognises word-form duration 'две минуты' + type 'медитацию'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "буквально две минуты медитацию" },
    ]);
    expect(result.hasDuration).toBe(true);
    expect(result.hasType).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("recognises 'пару минут' + type 'подышать'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "пару минут подышать" },
    ]);
    expect(result.hasDuration).toBe(true);
  });

  it("recognises digit duration '15 минут' + type 'йогу' as catalog conflict", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "15 минут йогу" },
    ]);
    expect(result.hasDuration).toBe(true);
    expect(result.hasType).toBe(true);
    expect(result.catalogConsistent).toBe(false);
    expect(result.confident).toBe(false);
  });

  it("rejects meditation 15 minutes as catalog conflict", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content: "Сегодня планирую покрасить лодку. А сейчас я бы хотел выполнить медитацию 15 минут.",
      },
    ]);
    expect(result.hasDuration).toBe(true);
    expect(result.hasType).toBe(true);
    expect(result.practiceKind).toBe("meditation");
    expect(result.durationSec).toBe(900);
    expect(result.catalogConsistent).toBe(false);
    expect(result.confident).toBe(false);
  });

  it("accepts breath 15 minutes as catalog-consistent", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "дыхание 15 минут" },
    ]);
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("treats a short breath request as the minimum supported duration", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "хочу короткую практику дыхания" },
    ]);
    expect(result.durationSec).toBe(5 * 60);
    expect(result.practiceKind).toBe("breath");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("treats a minimum meditation request as one minute", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "I want a minimal meditation practice" },
    ]);
    expect(result.durationSec).toBe(60);
    expect(result.practiceKind).toBe("meditation");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("accepts a catalog-safe breath duration range in a planning sentence", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content:
          "Добрый день! Прекрасный день! Через полчаса у меня начнется вебинар, поэтому я готов выполнить короткую практику дыхания 10-15 минут буквально.",
      },
    ]);
    expect(result.durationSec).toBe(13 * 60);
    expect(result.practiceKind).toBe("breath");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("does not let an event timing override a short meditation request", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content:
          "В магазин я через 15 минут пойду. Поэтому практику мне предложи какую-нибудь короткую медитацию.",
      },
    ]);
    expect(result.durationSec).toBe(60);
    expect(result.practiceKind).toBe("meditation");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("treats explicit type+duration as answered even when catalog conflicts", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "медитация 15 минут" },
    ]);
    expect(userAnsweredPracticeRequest(result)).toBe(true);
    expect(result.confident).toBe(false);
  });

  it("builds catalog reconciliation instruction for meditation 15 minutes", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "медитация 15 минут" },
    ]);
    const instruction = buildCatalogReconciliationInstruction(result);
    expect(instruction).toContain("15 мин");
    expect(instruction).toContain("медитация");
    expect(instruction).toContain("дыхательная практика");
    expect(instruction).toContain("здесь");
    expect(instruction).not.toContain("не до практики");
  });

  it("prefers the trailing minute duration in a noisy Russian STT phrase", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "А практику я бы хотел выполнить час дыхания, три минуты." },
    ]);
    expect(result.durationSec).toBe(180);
    expect(result.practiceKind).toBe("breath");
    expect(result.catalogConsistent).toBe(false);
  });

  it("recognises explicit first-message practice requests from packet B", () => {
    const samples = [
      "Я хочу выполнить дыхание в течение 15 минут",
      "дыхание 15 минут",
      "Просто предложи мне практику асан 25 минут",
      "Я хочу выполнить асаны 25 минут",
    ];

    for (const sample of samples) {
      const result = validateHistoryHasDurationAndType([{ role: "user", content: sample }]);
      expect(result.hasDuration, sample).toBe(true);
      expect(result.hasType, sample).toBe(true);
      expect(result.confident, sample).toBe(true);
    }
  });

  it("extracts durationSec and practiceKind: 'две минуты медитацию'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "буквально две минуты медитацию" },
    ]);
    expect(result.durationSec).toBe(120);
    expect(result.practiceKind).toBe("meditation");
  });

  it("accepts decimal meditation duration with comma", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "хочу 2,5 минуты медитации" },
    ]);
    expect(result.durationSec).toBe(150);
    expect(result.practiceKind).toBe("meditation");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("accepts decimal meditation duration with dot", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "хочу 2.5 минуты медитации" },
    ]);
    expect(result.durationSec).toBe(150);
    expect(result.practiceKind).toBe("meditation");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("extracts durationSec and practiceKind: '15 минут йогу'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "15 минут йогу" },
    ]);
    expect(result.durationSec).toBe(900);
    expect(result.practiceKind).toBe("yoga");
  });

  it("extracts durationSec from 'полчаса' and practiceKind 'подышать' without confident (30m > breath max)", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "полчаса подышать" },
    ]);
    expect(result.durationSec).toBe(1800);
    expect(result.practiceKind).toBe("breath");
    expect(result.catalogConsistent).toBe(false);
    expect(result.confident).toBe(false);
  });

  it("treats context + 'полчаса асан' as confident yoga for the final path", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content:
          "Сегодня будет важный разговор с клиентом. От этого разговора зависит доход на ближайшие несколько месяцев. И, возможно, я бы предпочел выполнить асаны примерно полчаса.",
      },
    ]);
    expect(result.durationSec).toBe(1800);
    expect(result.practiceKind).toBe("yoga");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("extracts durationSec from 'пять минут'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "пять минут пранаяму" },
    ]);
    expect(result.durationSec).toBe(300);
    expect(result.practiceKind).toBe("breath");
  });

  it("prefers practice duration over event timing in the same sentence", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content:
          "Через полчаса я планирую провести вебинар и это будет интересно, насыщенно. Чтобы подготовиться, предложи мне три минуты медитации.",
      },
    ]);
    expect(result.durationSec).toBe(3 * 60);
    expect(result.practiceKind).toBe("meditation");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("does not confuse incidental 'подышу' in day context with a final meditation request", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content:
          "Через полчаса я планирую начать вебинар. После вебинара в 11.40 нужно будет пойти за творогом. Заодно прогуляюсь, подышу, может быть сделаю зарядку. Далее, думаю, нужно вздремнуть. И в 4 часа поеду на балет. Готов сейчас выполнить три минуты медитации.",
      },
    ]);
    expect(result.durationSec).toBe(3 * 60);
    expect(result.practiceKind).toBe("meditation");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("uses last mentioned values when user changes mind across messages", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "хочу 3 минуты медитацию" },
      { role: "assistant", content: "хорошо, 3 минуты медитации" },
      { role: "user", content: "нет, лучше 5 минут дыхание" },
    ]);
    expect(result.durationSec).toBe(300);
    expect(result.practiceKind).toBe("breath");
  });

  it("does not let a later clock-time message overwrite an already confirmed practice request", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "Да, выспался, прекрасно себя чувствую и хотел бы выполнить 15 минут дыхания." },
      { role: "user", content: "Давно не виделись. Четыре часа дня мы с ним договорились встретиться." },
    ]);
    expect(result.durationSec).toBe(15 * 60);
    expect(result.practiceKind).toBe("breath");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("keeps the confirmed practice duration when the same reply mentions an older rejected value", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content:
          "Хорошо, пять минут медитации, хотя перед этим я тебе говорил три минуты, это вроде меньше и непонятно куда сокращать, но если ты хочешь пять, то пусть будет пять.",
      },
    ]);
    expect(result.durationSec).toBe(5 * 60);
    expect(result.practiceKind).toBe("meditation");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("confirms 21 min asanas after catalog reconciliation (dialog 489E)", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content:
          "Сегодня планируется важная встреча. Но что касается практик, я бы предпочел 15 минут асан.",
      },
      { role: "user", content: "Прошу 21 минуту асан." },
    ]);
    expect(result.durationSec).toBe(21 * 60);
    expect(result.practiceKind).toBe("yoga");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("prefers the last practice kind mention inside one mixed sentence", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content: "Что касается практики йоги, я бы сейчас выполнил короткую практику дыхания.",
      },
    ]);
    expect(result.durationSec).toBe(5 * 60);
    expect(result.practiceKind).toBe("breath");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("returns null for durationSec/practiceKind when not mentioned", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "привет, как дела" },
    ]);
    expect(result.durationSec).toBeNull();
    expect(result.practiceKind).toBeNull();
    expect(result.confident).toBe(false);
  });

  it("extracts 'час' as 3600 sec", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "час йоги" },
    ]);
    expect(result.durationSec).toBe(3600);
    expect(result.practiceKind).toBe("yoga");
  });

  it("treats 'йогу в течение часа' as a valid hour-long yoga request", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "Да, практику я бы хотел выполнить йогу в течение часа." },
    ]);
    expect(result.hasDuration).toBe(true);
    expect(result.durationSec).toBe(3600);
    expect(result.practiceKind).toBe("yoga");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("treats 4 hours of yoga as a catalog conflict", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "хочу асаны 4 часа" },
    ]);
    expect(result.durationSec).toBe(4 * 60 * 60);
    expect(result.practiceKind).toBe("yoga");
    expect(result.catalogConsistent).toBe(false);
    expect(result.confident).toBe(false);
  });

  it("keeps explicit reversed-order duration in 'йоги минут 40' instead of collapsing to the minimum hint", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "Думаю выполнить небольшую практику йоги минут 40." },
    ]);

    expect(result.durationSec).toBe(40 * 60);
    expect(result.practiceKind).toBe("yoga");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("extracts 'четверть часа' as 900 sec", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "четверть часа помедитировать" },
    ]);
    expect(result.durationSec).toBe(900);
    expect(result.practiceKind).toBe("meditation");
  });

  it("extracts '3/4 часа' as 45 minutes", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "хочу асаны 3/4 часа" },
    ]);
    expect(result.durationSec).toBe(45 * 60);
    expect(result.practiceKind).toBe("yoga");
    expect(result.catalogConsistent).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("does not treat 'подышать или через тело' as exclusive breath (keeps yoga from earlier message)", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content: "хочу практику йоги для разговора с шефом",
      },
      {
        role: "user",
        content: "мне все равно подышать или через тело. посоветуй что лучше",
      },
      { role: "user", content: "минут 15-20 хотелось бы." },
    ]);
    expect(result.practiceKind).toBe("yoga");
    expect(result.durationSec).toBe(1080);
  });
});

describe("userDeclinedPracticeInHistory", () => {
  it("detects explicit session refusal phrases from dialog test 4", () => {
    expect(userDeclinedPracticeInHistory(["Практику выполнять я не хочу"])).toBe(true);
    expect(userDeclinedPracticeInHistory(["не хочу выполнять сейчас никакую практику"])).toBe(true);
    expect(userDeclinedPracticeInHistory(["Никакую практику не хочу выполнять."])).toBe(true);
    expect(userDeclinedPracticeInHistory(["Да, практика совсем не нужна"])).toBe(true);
    expect(userDeclinedPracticeInHistory(["Практика мне сейчас не нужна, давайте без нее"])).toBe(true);
    expect(userDeclinedPracticeInHistory(["Нет, сейчас не до практик."])).toBe(true);
    expect(userDeclinedPracticeInHistory(["Нет времени выполнять какую-либо практику."])).toBe(true);
    expect(userDeclinedPracticeInHistory(["Что касается практики, нет сейчас времени этим заниматься."])).toBe(true);
    expect(userDeclinedPracticeInHistory(["Через 10 минут вебинар, времени для практик нет."])).toBe(true);
    expect(userDeclinedPracticeInHistory(["Не нужно предлагать практику."])).toBe(true);
    expect(userDeclinedPracticeInHistory([
      "Через полчаса я планирую провести вебинар. И нет времени сейчас для практик.",
      "Я хочу, чтобы люди узнали что-то новое. И нет времени выполнять асаны, пранаяму.",
    ])).toBe(true);
  });

  it("does not treat unresolved day talk as refusal", () => {
    expect(userDeclinedPracticeInHistory(["Сложный день, устал после встреч"])).toBe(false);
  });
});

describe("parseResponseMarkers", () => {
  it("extracts card_blurb from PRACTICE_PICK marker", () => {
    const parsed = parseResponseMarkers(
      `[PRACTICE_PICK: id="breath:coherent" reason="ok" duration_min="10" chakra="4" card_blurb="Когерентное дыхание мягко выравнивает внутренний ритм и помогает вернуть опору в напряжённый день. Выполняя эту практику, удерживайте внимание на ясности, устойчивости и внутренней тишине. Если вы владеете пранаямой, дышите через Анахату."]\nТекст ответа`,
    );

    expect(parsed.practicePick?.id).toBe("breath:coherent");
    expect(parsed.practicePick?.cardBlurb).toContain("удерживайте внимание");
    expect(parsed.practicePick?.durationMin).toBe(10);
    expect(parsed.practicePick?.chakra).toBe(4);
  });

  it("returns null card_blurb when field is absent", () => {
    const parsed = parseResponseMarkers(`[PRACTICE_PICK: id="default" reason="fallback"]`);
    expect(parsed.practicePick?.cardBlurb).toBeNull();
  });

  it("predictably parses card_blurb with nested double quotes without throwing", () => {
    const parsed = parseResponseMarkers(
      `[PRACTICE_PICK: id="breath:coherent" reason="ok" card_blurb="Текст с "двойными" кавычками внутри"]`,
    );
    expect(parsed.practicePick?.id).toBe("breath:coherent");
    expect(parsed.practicePick?.cardBlurb).toBe(`Текст с "двойными" кавычками внутри`);
  });

  it("parses planning and summarizing markers for life matrix flow", () => {
    const parsed = parseResponseMarkers(
      [
        `[PLANNED_EVENT: desc="Разговор с руководителем" time="завтра утром" time_norm="tomorrow morning" cells="3:5:0.7;6:5:0.3" snippets="встреча с начальником;надо собраться"]`,
        `[SUMMARIZE_EVENT: ref="1" outcome="прошло спокойнее, чем ожидалось" outcome_cells="3:5:0.4;2:4:0.6"]`,
        `[MATRIX_CELLS: 3:5:0.4;2:4:0.6]`,
        `[PLAN_TOMORROW]`,
      ].join("\n"),
    );

    expect(parsed.planTomorrow).toBe(true);
    expect(parsed.plannedEvents).toHaveLength(1);
    expect(parsed.plannedEvents[0]?.desc).toBe("Разговор с руководителем");
    expect(parsed.plannedEvents[0]?.cells).toEqual([
      { sphere: 3, chakra: 5, weight: 1 },
      { sphere: 6, chakra: 5, weight: 1 },
    ]);
    expect(parsed.summarizeEvents).toHaveLength(1);
    expect(parsed.summarizeEvents[0]?.ref).toBe("1");
    expect(parsed.matrixCells).toEqual([
      { sphere: 3, chakra: 5, weight: 1 },
      { sphere: 2, chakra: 4, weight: 1 },
    ]);
  });
});
