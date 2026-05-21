import { describe, expect, it } from "vitest";

import { decideTurnMode, ORCHESTRATOR_INSTRUCTIONS } from "./dialogArcOrchestrator";

describe("decideTurnMode", () => {
  it("requires card_blurb in final recommendation instructions", () => {
    expect(ORCHESTRATOR_INSTRUCTIONS.final_recommendation).toContain('card_blurb="..."');
    expect(ORCHESTRATOR_INSTRUCTIONS.fast_track_final).toContain("{{chakra_label_accusative}}");
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

  it("uses practice_declined after an explicit refusal", () => {
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

    expect(decision.mode).toBe("practice_declined");
    expect(decision.instruction).toContain("отказался от практики");
  });
});
