import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  collapseDuplicatePlannedEventRows,
  inferPlannedEventsFromUserHistory,
  isAddFlowPlanningScaffoldDescription,
  isMetaPlanningIntentDescription,
  mergePlannedEventMarkers,
  samePlannedEventIdentity,
} from "./plannedEventInference";

const TZ = "Europe/Moscow";

describe("inferPlannedEventsFromUserHistory", () => {
  it("extracts a timed event from a user message with relative time", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [
        {
          role: "user",
          content:
            "Добрый день! Прекрасный день! Через полчаса у меня начнется вебинар, поэтому я готов выполнить короткую практику дыхания 10-15 минут буквально.",
        },
      ],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.time).toBe("через полчаса");
    expect(inferred[0]?.desc.toLowerCase()).toContain("вебинар");
  });

  it("strips Russian speech lead-in like «Тогда хочу» from inferred labels", () => {
    const nowLocal = DateTime.fromISO("2026-09-06T08:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Тогда хочу убрать квартиру." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc.toLowerCase()).toBe("убрать квартиру");
  });

  it("ignores short duration-only replies", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "15 минут" }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("keeps a named action when the turn also says «больше ничего»", () => {
    const nowLocal = DateTime.fromISO("2026-07-20T18:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [
        {
          role: "assistant",
          content: "Что важного вы хотите запланировать на текущий день?",
        },
      ],
      pendingUserMessage: "Снова хотел бы посмотреть хороший фильм. И больше ничего.",
      nowLocal,
      tz: TZ,
      locale: "ru",
    });
    expect(inferred.length).toBeGreaterThanOrEqual(1);
    expect(inferred.some((item) => /фильм/i.test(item.desc))).toBe(true);
    expect(inferred.every((item) => !/больше\s+ничего/i.test(item.desc))).toBe(true);
  });

  it("does not turn an empty-plan refusal into a planned action", () => {
    const nowLocal = DateTime.fromISO("2026-07-11T12:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [
        {
          role: "assistant",
          content: "Что важного вы хотите запланировать на текущий день?",
        },
      ],
      pendingUserMessage: "Ничего планировать не хочу.",
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("keeps the concrete action and drops meta «добавить действие про…» preamble", () => {
    const nowLocal = DateTime.fromISO("2026-07-20T23:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [
        {
          role: "assistant",
          content: "Есть что-то ещё, что вы хотели бы добавить к этому дню?",
        },
      ],
      pendingUserMessage:
        "Да, я решил добавить действие про отдых. Встречусь вечером с друзьями, в кафе посидим, расслабимся, пообщаемся.",
      nowLocal,
      tz: TZ,
      locale: "ru",
    });
    expect(inferred.some((item) => /друзья|кафе/i.test(item.desc))).toBe(true);
    expect(inferred.every((item) => !/добавить\s+действие/i.test(item.desc))).toBe(true);
    expect(inferred.every((item) => !/^[,;]/.test(item.desc.trim()))).toBe(true);
  });

  it("does not treat concrete «добавь пробежку» as meta intent", () => {
    expect(isMetaPlanningIntentDescription("Добавь еще пробежку")).toBe(false);
    expect(isMetaPlanningIntentDescription("я решил добавить действие про отдых")).toBe(true);
    expect(isMetaPlanningIntentDescription(", я решил добавить действие про отдых")).toBe(true);
  });

  it("drops «подумал… из сферы отдыха» scaffolding in add-flow inference", () => {
    expect(isMetaPlanningIntentDescription("Подумал, что стоит добавить что-нибудь из сферы отдыха")).toBe(true);
    expect(isAddFlowPlanningScaffoldDescription("Подумал, что стоит добавить что-нибудь из сферы отдыха")).toBe(true);
    expect(isMetaPlanningIntentDescription("решил добавить вкусный торт")).toBe(false);

    const nowLocal = DateTime.fromISO("2026-07-20T23:20:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [
        {
          role: "assistant",
          content: "Что бы вы хотели добавить к этому дню?",
        },
      ],
      pendingUserMessage:
        "Да, я подумал, что стоит добавить что-нибудь из сферы отдыха. И поэтому решил добавить вкусный торт, который вечером скушаю.",
      nowLocal,
      tz: TZ,
      locale: "ru",
      addFlow: true,
    });
    // Scaffolding must never become a card; the concrete cake may arrive via model markers.
    expect(inferred.every((item) => !/подумал|сфер\p{L}*\s+отдых/iu.test(item.desc))).toBe(true);
    expect(inferred.every((item) => !isAddFlowPlanningScaffoldDescription(item.desc))).toBe(true);
  });

  it("extracts explicit clock time from a planning clause", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Сегодня в 18:00 у меня созвон с командой." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.time).toMatch(/18:00/);
    expect(inferred[0]?.desc.toLowerCase()).toContain("созвон");
  });

  it("ignores low-signal time fragments that do not describe an event", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T19:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Хотелось бы в 11.30 примерно." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("strips the practice request tail from a planning sentence", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T19:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "В 11.20 планирую лечь спать, а пока предложи мне 12 минут дыхательных упражнений." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.time).toBe("в 11.20");
    expect(inferred[0]?.desc).toBe("лечь спать");
  });

  it("drops discourse prefixes from planned event descriptions", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T14:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "И главное, я хочу лечь в 11.30 сегодня." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc).toBe("лечь спать");
    expect(inferred[0]?.time).toBe("в 11.30");
  });

  it("does not create a new plan from a past-tense summary sentence", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T00:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Да, я хорошо выспался этой ночью." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("does not turn a summarized evening into new planning candidates", () => {
    const nowLocal = DateTime.fromISO("2026-06-03T21:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Потом почитал книгу, поужинал. Вообще хороший вечер был." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("infers an evening default for a time-less movie plan", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T14:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Сегодня тоже интересные планы. Хочу посмотреть фильм. Бронсон называется." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc).toBe("посмотреть фильм");
    expect(inferred[0]?.time).toBeNull();
    expect(inferred[0]?.timeNorm).toBe("сегодня вечером");
  });

  it("treats breakfast words as planning, not as the date word 'tomorrow'", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T09:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Хочу позавтракать зеленым коктейлем." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc).toContain("позавтракать");
    expect(inferred[0]?.timeNorm).toBe("сегодня утром");
  });

  it("infers a theater plan from 'хотел бы' without explicit time", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T09:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "А еще хотел бы в театр сходить, правда не знаю получится или не получится." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc).toBe("в театр сходить");
    expect(inferred[0]?.timeNorm).toBe("сегодня вечером");
  });

  it("does not create a generic 'interesting day' planned event", () => {
    const nowLocal = DateTime.fromISO("2026-06-02T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Сегодня у меня предстоит интересный день." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("splits film and dinner into separate planned events", () => {
    const nowLocal = DateTime.fromISO("2026-06-02T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{
        role: "user",
        content: "Также вечером хочу посмотреть интересный фильм и сделать хороший, здоровый, вкусный ужин.",
      }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(2);
    expect(inferred.map((item) => item.desc)).toEqual([
      "посмотреть интересный фильм",
      "сделать хороший, здоровый, вкусный ужин",
    ]);
    expect(inferred.map((item) => item.time)).toEqual(["вечером", "вечером"]);
  });

  it("keeps separate day actions for boat, cinema, and earlier sleep", () => {
    const nowLocal = DateTime.fromISO("2026-06-18T01:25:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [],
      pendingUserMessage: "Я хочу посмотреть лодку в магазине, сходить в кино и пораньше лечь спать.",
      nowLocal,
      relativeNowLocal: nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred.map((item) => item.desc)).toEqual([
      "посмотреть лодку в магазине",
      "сходить в кино",
      "пораньше лечь спать",
    ]);
  });

  it("keeps Italian future work and sleep-goal actions on the first planning turn", () => {
    const nowLocal = DateTime.fromISO("2026-06-18T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [],
      pendingUserMessage: "Andrò a lavorare. L'unico obiettivo è non dormire tardi.",
      nowLocal,
      relativeNowLocal: nowLocal,
      tz: TZ,
      locale: "it",
    });

    expect(inferred.map((item) => item.desc)).toEqual([
      "Andrò a lavorare",
      "non dormire tardi",
    ]);
  });

  it("keeps a supportive pair like walk plus fresh air as one event", () => {
    const nowLocal = DateTime.fromISO("2026-06-02T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Сегодня вечером хочу погулять и подышать свежим воздухом." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc).toContain("погулять");
    expect(inferred[0]?.desc).toContain("подышать свежим воздухом");
  });

  it("does not turn a summarizing lived-state reply into planned events", () => {
    const nowLocal = DateTime.fromISO("2026-07-20T19:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [],
      pendingUserMessage:
        "Это был прекрасный вечер. Мы сидели, общались. И я получил огромное удовольствие. Почувствовал радость, тепло общения.",
      nowLocal,
      relativeNowLocal: nowLocal,
      tz: TZ,
      locale: "ru",
    });
    expect(inferred).toHaveLength(0);
  });

  it("does not resurrect an old planning topic from too far back in history", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T09:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [
        { role: "user", content: "Сегодня заеду в офис за документами." },
        { role: "user", content: "Сейчас настроение спокойное." },
        { role: "user", content: "Пока просто делюсь мыслями." },
        { role: "user", content: "Хочется больше тишины внутри." },
        { role: "user", content: "Ничего нового сегодня не добавляю." },
      ],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("skips causal support clauses when a concrete activity already carries the plan", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T09:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{
        role: "user",
        content:
          "А вечером хочу на велосипеде покататься. Потому что нужно ведь и спортом заниматься.",
      }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc).toContain("велосипед");
    expect(inferred[0]?.time).toBe("вечером");
  });

  it("drops 'думаю, что' wrappers from a timed office plan", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T09:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Я думаю, что через полчаса я уже приеду в офис." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc).toBe("уже приеду в офис");
    expect(inferred[0]?.time).toBe("через полчаса");
  });

  it("extracts several concrete plans from one long spontaneous reply", () => {
    const nowLocal = DateTime.fromISO("2026-05-27T13:19:15", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{
        role: "user",
        content:
          "Сегодня я хочу поехать в магазин посмотреть надувные лодки так как впереди лето то хочется купить какую-то лодку с мотором но хочу сначала прицениться почувствовать вообще каково она будет мне необходимость в этой покупке или нет так как не знаю вообще проведу ли я лето здесь на озере или может быть поеду в питер а если поеду в питер то возьму с собой сабборд и буду у нас сабборд Вечером, думаю, фильм посмотреть, тоже выбрать какой-нибудь так, чтобы расслабиться, отдохнуть. Перед фильмом, может быть, погуляю сначала, да, где-то еще погулять хочу в парке, час хотя бы, чтобы потом лучше мне спалось, и спать хочу лечь не поздно, примерно в 11.30. Вот такие планы на этот На этот день.",
      }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    const descriptions = inferred.map((item) => item.desc.toLowerCase());
    expect(descriptions.some((item) => item.includes("магазин") && item.includes("лод"))).toBe(true);
    expect(descriptions.some((item) => item.includes("фильм"))).toBe(true);
    expect(descriptions.some((item) => item.includes("парк") || item.includes("погуля"))).toBe(true);
    expect(descriptions.some((item) => item.includes("лечь спать") || item.includes("спать"))).toBe(true);
  });

  it("does not treat Italian planning-done closure as a planned action", () => {
    const nowLocal = DateTime.fromISO("2026-06-19T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [
        {
          role: "user",
          content:
            "Oggi mi resta ancora molto lavoro. Oggi d'inverno forse andrò al cinema. Questo è il più importante.",
        },
        {
          role: "assistant",
          content: "C'è altro che vuoi aggiungere al piano per oggi?",
        },
        { role: "user", content: "Non voglio aggiungere più niente." },
      ],
      nowLocal,
      tz: TZ,
      locale: "it",
    });

    const descriptions = inferred.map((item) => item.desc.toLowerCase());
    expect(descriptions.some((item) => item.includes("non voglio aggiungere"))).toBe(false);
    expect(descriptions.some((item) => item.includes("lavor") || item.includes("cinema"))).toBe(true);
  });

  it("does not turn vague workload talk into a planned event", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T09:05:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Да, нужно поработать, много дел, я не знаю как пойдет все." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("keeps the concrete client meeting, skips practice noise, and keeps real evening plans", () => {
    const nowLocal = DateTime.fromISO("2026-06-03T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{
        role: "user",
        content:
          "На сегодня у меня планируется встреча с клиентом и это, пожалуй, самое важное событие дня. Нужно будет почувствовать хорошо его интересы, сопоставить с моими интересами. А вечером хочу погулять в парке. Может быть потом фильм посмотрю перед сном и лягу спать пораньше, где-нибудь в полдвенадцатого. А практику я бы хотел выполнить час дыхания, три минуты.",
      }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred.map((item) => item.desc)).toEqual([
      "планируется встреча с клиентом",
      "погулять в парке",
      "Может быть потом фильм посмотрю перед сном и лягу спать пораньше, где-нибудь в",
    ]);
    expect(inferred.some((item) => /практик|дыхани/i.test(item.desc))).toBe(false);
  });

  it("ignores bare time clarifications without an event", () => {
    const nowLocal = DateTime.fromISO("2026-06-02T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Я планирую на 8." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("recognises a clarification as the same client meeting", () => {
    expect(samePlannedEventIdentity(
      "Встреча с клиентом, от которой зависит доход на несколько месяцев",
      "встречи с клиентом. Договорились встретиться и нужно будет мне проявить некоторое упорство",
    )).toBe(true);
  });

  it("recognises a generic time clarification as the same meeting", () => {
    expect(samePlannedEventIdentity(
      "Встреча с клиентом, от которой зависит доход на несколько месяцев",
      "По времени встреча пройдет",
    )).toBe(true);
  });

  it("recognises a generic store clarification as the same shopping plan", () => {
    expect(samePlannedEventIdentity(
      "в магазин пойти посмотреть моторные лодки",
      "В магазин я пойду",
    )).toBe(true);
  });

  it("recognises Italian rewordings of the same measured action", () => {
    expect(samePlannedEventIdentity("Corsa di 3 km", "Correre 3 km")).toBe(true);
  });

  it("recognises Italian study rewordings of the same one-hour English lesson", () => {
    expect(samePlannedEventIdentity(
      "Studio di inglese per un'ora",
      "Vorrei studiare l'inglese per un'ora",
    )).toBe(true);
  });

  it("recognises Russian eat/cake rewordings of the same treat", () => {
    expect(samePlannedEventIdentity("Кекс поесть", "Съесть кекс")).toBe(true);
  });

  it("recognises Russian speech-blob vs polished labels of the same action", () => {
    expect(samePlannedEventIdentity("Тогда хочу убрать квартиру", "Уборка квартиры")).toBe(true);
    expect(samePlannedEventIdentity("Тогда хочу позвонить маме", "Звонок маме")).toBe(true);
    expect(samePlannedEventIdentity(
      "Тогда хочу отдыхать у озера, читая книгу",
      "Отдых у озера с книгой и блокнотом",
    )).toBe(true);
    expect(samePlannedEventIdentity("Поездка к озеру на природу", "Съездить к озеру на красивый вид")).toBe(true);
    expect(samePlannedEventIdentity("Уборка квартиры", "Звонок маме")).toBe(false);
  });

  it("collapses duplicate planned rows that reword the same action", () => {
    const { kept, droppedIds } = collapseDuplicatePlannedEventRows([
      { id: "raw-1", description: "Тогда хочу убрать квартиру", recommendation_text: null, status: "planned", planned_local_date: "2026-09-06" },
      { id: "keep-1", description: "Уборка квартиры", recommendation_text: "Делайте не спеша.", status: "planned", planned_local_date: "2026-09-06" },
      { id: "other", description: "Суставная гимнастика и массаж шеи", recommendation_text: "Внимание на тело.", status: "planned", planned_local_date: "2026-09-06" },
    ]);
    expect(kept.map((row) => row.id).sort()).toEqual(["keep-1", "other"]);
    expect(droppedIds).toEqual(["raw-1"]);
  });

  it("prefers the model marker when history clarification describes the same event", () => {
    const nowLocal = DateTime.fromISO("2026-05-26T09:05:00", { zone: TZ });
    const merged = mergePlannedEventMarkers(
      [
        {
          desc: "Встреча с клиентом, от которой зависит доход на несколько месяцев",
          time: "13:00",
          timeNorm: "13:00",
          recommendation: null,
          displayOrder: null,
          cells: [],
          snippets: [],
        },
      ],
      [
        {
          desc: "встречи с клиентом. Договорились встретиться и нужно будет мне проявить некоторое упорство",
          time: "в час дня",
          timeNorm: null,
          recommendation: null,
          displayOrder: null,
          cells: [],
          snippets: [],
        },
      ],
      { nowLocal, tz: TZ, locale: "ru" },
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.desc).toContain("Встреча с клиентом");
    expect(merged[0]?.time).toBe("13:00");
  });
});

describe("English coordinated planning labels", () => {
  it("splits boat and cinema into essence labels, not the full utterance", () => {
    const nowLocal = DateTime.fromISO("2026-09-04T13:30:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [],
      pendingUserMessage:
        "During the day I want to go to the store to choose an inflatable boat, and in the evening to go to the cinema.",
      nowLocal,
      relativeNowLocal: nowLocal,
      tz: TZ,
      locale: "en",
    });

    const descriptions = inferred.map((item) => item.desc.toLowerCase());
    expect(descriptions).toHaveLength(2);
    expect(descriptions[0]).toMatch(/store|boat/);
    expect(descriptions[0]).not.toMatch(/cinema/);
    expect(descriptions[0]).not.toMatch(/i want/);
    expect(descriptions[0]).not.toMatch(/during the day/);
    expect(descriptions[1]).toMatch(/cinema/);
    expect(descriptions[1]).not.toMatch(/boat/);
    expect(descriptions.every((item) => item.length < 70)).toBe(true);
  });

  it("keeps a store visit and purchase as one outing when there is no time shift", () => {
    const nowLocal = DateTime.fromISO("2026-09-04T13:30:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [],
      pendingUserMessage: "I want to go to the store and buy an inflatable boat.",
      nowLocal,
      relativeNowLocal: nowLocal,
      tz: TZ,
      locale: "en",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.desc.toLowerCase()).toMatch(/store|boat/);
    expect(inferred[0]?.desc.toLowerCase()).not.toMatch(/^i want/);
  });
});
