import { describe, expect, it } from "vitest";

import {
  dayPartRhetoricInstruction,
  dialogTimeOfDayForHour,
  greetingInstructionForTimeOfDay,
  greetingPhraseForTimeOfDay,
  isEarlyCalendarMorning,
  phaseTimeForHour,
} from "./dialogTimeOfDay";

describe("dialogTimeOfDay", () => {
  it("allows good night greeting at 01:20", () => {
    expect(dialogTimeOfDayForHour(1)).toBe("night");
    expect(greetingPhraseForTimeOfDay("night", "ru")).toBe("Доброй ночи");
    expect(greetingInstructionForTimeOfDay("night", "ru", "вы", 1)).toContain("Доброй ночи");
    expect(greetingInstructionForTimeOfDay("midday", "ru", "вы", 14)).toContain("Добрый день");
  });

  it("bans wrong evening rhetoric after midnight but allows good night greeting", () => {
    expect(isEarlyCalendarMorning(1)).toBe(true);
    expect(dayPartRhetoricInstruction(1, "ru")).toMatch(/уже вечер/);
    expect(dayPartRhetoricInstruction(1, "ru")).toMatch(/Доброй ночи.*допустимо/);
    expect(dayPartRhetoricInstruction(23, "ru")).toBe("");
  });

  it("maps greeting windows", () => {
    expect(greetingPhraseForTimeOfDay("morning", "ru")).toBe("Доброе утро");
    expect(greetingPhraseForTimeOfDay("midday", "ru")).toBe("Добрый день");
    expect(greetingPhraseForTimeOfDay("evening", "ru")).toBe("Добрый вечер");
    expect(dialogTimeOfDayForHour(8)).toBe("morning");
    expect(dialogTimeOfDayForHour(14)).toBe("midday");
    expect(dialogTimeOfDayForHour(19)).toBe("evening");
  });

  it("does not classify 01:00 as evening phase", () => {
    expect(phaseTimeForHour(1)).toBe("morning");
    expect(phaseTimeForHour(19)).toBe("evening");
  });
});
