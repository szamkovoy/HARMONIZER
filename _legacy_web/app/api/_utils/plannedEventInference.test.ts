import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { inferPlannedEventsFromUserHistory, mergePlannedEventMarkers, samePlannedEventIdentity } from "./plannedEventInference";

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
