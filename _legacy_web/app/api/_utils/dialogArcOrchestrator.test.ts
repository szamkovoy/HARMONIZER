import { describe, expect, it } from "vitest";

import { decideTurnMode, ORCHESTRATOR_INSTRUCTIONS } from "./dialogArcOrchestrator";

describe("decideTurnMode", () => {
  it("requires card_blurb in final recommendation instructions", () => {
    expect(ORCHESTRATOR_INSTRUCTIONS.final_recommendation).toContain('card_blurb="..."');
    expect(ORCHESTRATOR_INSTRUCTIONS.fast_track_final).toContain("{{chakra_label_accusative}}");
  });

  it("keeps planning inquiry focused and blocks pseudo-psychology outside finals", () => {
    expect(ORCHESTRATOR_INSTRUCTIONS.inquiry).toContain("НЕ уточняй психологический подтекст");
    expect(ORCHESTRATOR_INSTRUCTIONS.inquiry).toContain("Не проси выбрать точное число внутри диапазона");
    expect(ORCHESTRATOR_INSTRUCTIONS.inquiry).toContain("это асаны");
    expect(ORCHESTRATOR_INSTRUCTIONS.inquiry).toContain("Не играй роль психолога");
  });

  it("keeps opening on one clear branch question without asking about practice", () => {
    expect(ORCHESTRATOR_INSTRUCTIONS.opening).toContain("Не спрашивай про практику в первом сообщении");
    expect(ORCHESTRATOR_INSTRUCTIONS.opening).toContain("Один ясный вопрос за ход");
    expect(ORCHESTRATOR_INSTRUCTIONS.opening).toContain("восклицательный знак");
  });

  it("forbids interim feedback during per-event summarizing", () => {
    expect(ORCHESTRATOR_INSTRUCTIONS.inquiry).toContain("НЕ давай обратную связь");
    expect(ORCHESTRATOR_INSTRUCTIONS.inquiry).toContain("только ОДНО событие");
  });

  it("uses inquiry after opening when meditation duration conflicts with catalog", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Доброе утро. Сколько минут есть на практику и что ближе — асаны, дыхание или медитация?",
          meta: { turn_mode: "opening" },
        },
      ],
      2,
      9,
      "Сегодня планирую покрасить лодку. А сейчас я бы хотел выполнить медитацию 15 минут.",
    );

    expect(decision.mode).toBe("inquiry");
    expect(decision.modelTier).toBe("standard");
    expect(decision.instructionVariables?.practice_refusal_check ?? "").toBe("");
    expect(decision.instructionVariables?.catalog_reconciliation ?? "").toContain("15 мин");
    expect(decision.instructionVariables?.catalog_reconciliation ?? "").toContain("дыхательная практика");
  });

  it("uses fast_track_final for an explicit first user request", () => {
    const decision = decideTurnMode([], 1, 9, "дыхание 15 минут");

    expect(decision.mode).toBe("fast_track_final");
    expect(decision.modelTier).toBe("premium");
  });

  it("uses fast_track_final for the first substantive user reply after opening", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Добрый вечер. Что у вас сегодня происходит и сколько времени есть на практику?",
          meta: { turn_mode: "opening" },
        },
      ],
      2,
      9,
      "Я хочу выполнить дыхание в течение 15 минут",
    );

    expect(decision.mode).toBe("fast_track_final");
    expect(decision.modelTier).toBe("premium");
  });

  it("does not fast-track a rich first reply that also includes practice", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Доброе утро. Что у вас сегодня на повестке и сколько минут есть на практику?",
          meta: { turn_mode: "opening" },
        },
      ],
      2,
      9,
      "Сегодня предстоит важный разговор с клиентом, от которого зависит доход на ближайшее время. И практику я бы хотел выполнить 35 минут асаны.",
    );

    expect(decision.mode).toBe("inquiry");
    expect(decision.modelTier).toBe("standard");
  });

  it("does not fast-track a first reply with business context and half-hour asanas", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Доброе утро. Что у вас сегодня на повестке и сколько минут есть на практику?",
          meta: { turn_mode: "opening" },
        },
      ],
      2,
      9,
      "Сегодня будет важный разговор с клиентом. От этого разговора зависит доход на ближайшие несколько месяцев. И, возможно, я бы предпочел выполнить асаны примерно полчаса.",
    );

    expect(decision.mode).toBe("inquiry");
    expect(decision.modelTier).toBe("standard");
  });

  it("asks about practice refusal after the first unresolved opening reply by default", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Добрый вечер. Что у вас сегодня происходит и сколько времени есть на практику?",
          meta: { turn_mode: "opening" },
        },
      ],
      2,
      9,
      "Хочется что-то спокойное, день тяжелый",
    );

    expect(decision.mode).toBe("inquiry");
    expect(decision.instructionVariables?.practice_refusal_check ?? "").toContain("явного отказа");
  });

  it("adds practice_refusal_check after two unresolved opening/inquiry turns", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Добрый вечер. Что у вас сегодня происходит и сколько времени есть на практику?",
          meta: { turn_mode: "opening" },
        },
        { role: "user", content: "Сложный день, устал после встреч" },
        {
          role: "assistant",
          content: "Похоже, день напряженный. Сколько минут есть и что ближе: дыхание, медитация или асаны?",
          meta: { turn_mode: "inquiry" },
        },
        { role: "user", content: "Да, я все еще перевариваю разговор с начальником" },
      ],
      3,
      9,
      "И все это не отпускает",
    );

    expect(decision.mode).toBe("inquiry");
    expect(decision.instructionVariables?.practice_refusal_check ?? "").toContain("явного отказа");
  });

  it("uses final_without_practice after an explicit refusal", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Сколько времени на практику?",
          meta: { turn_mode: "opening" },
        },
      ],
      2,
      9,
      "Практику выполнять я не хочу",
    );

    expect(decision.mode).toBe("final_without_practice");
    expect(decision.instruction).toContain("финальный ход диалога без карточки практики");
  });

  it("uses final_without_practice for 'времени для практик нет' on the first reply", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Сколько времени на практику?",
          meta: { turn_mode: "opening" },
        },
      ],
      2,
      9,
      "Через 10 минут вебинар, времени для практик нет.",
    );

    expect(decision.mode).toBe("final_without_practice");
  });

  it("uses final_without_practice for 'что касается практики, нет сейчас времени этим заниматься'", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Сколько времени на практику?",
          meta: { turn_mode: "opening" },
        },
      ],
      2,
      9,
      "Что касается практики, нет сейчас времени этим заниматься.",
    );

    expect(decision.mode).toBe("final_without_practice");
  });

  it("uses post_recommendation after a picked practice for a thank-you", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Вот практика ниже.",
          meta: { practice_picked: { id: "practice-1" }, turn_mode: "final_recommendation" },
        },
      ],
      3,
      9,
      "Спасибо.",
    );

    expect(decision.mode).toBe("post_recommendation");
    expect(decision.modelTier).toBe("standard");
  });

  it("uses practice_repick when the user asks for another practice after an offer", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Вот практика ниже.",
          meta: { practice_picked: { id: "practice-1" }, turn_mode: "final_recommendation" },
        },
      ],
      3,
      9,
      "Предложи другую практику, эту я уже делал.",
    );

    expect(decision.mode).toBe("practice_repick");
    expect(decision.modelTier).toBe("premium");
  });

  it("keeps practice_repick available after a short post-recommendation reply", () => {
    const decision = decideTurnMode(
      [
        {
          role: "assistant",
          content: "Вот практика ниже.",
          meta: { practice_picked: { id: "practice-1" }, turn_mode: "final_recommendation" },
        },
        {
          role: "assistant",
          content: "Хорошего дня.",
          meta: { turn_mode: "post_recommendation" },
        },
      ],
      4,
      9,
      "Предложи другую практику, пожалуйста.",
    );

    expect(decision.mode).toBe("practice_repick");
    expect(decision.modelTier).toBe("premium");
  });
});
