import type { PhaseTime } from "@legacy/app/api/_utils/dialogBranching";

/** Prompt-facing time bucket for greetings. Night spans 22:00–03:00. */
export type DialogTimeOfDay = "morning" | "midday" | "evening" | "night";

export function dialogTimeOfDayForHour(hour: number): DialogTimeOfDay {
  const h = ((hour % 24) + 24) % 24;
  if (h < 3 || h >= 22) return "night";
  if (h < 10) return "morning";
  if (h < 17) return "midday";
  return "evening";
}

/** After midnight the calendar day has just begun — ban wrong day-part rhetoric, not «Доброй ночи». */
export function isEarlyCalendarMorning(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h < 3;
}

/** Branch/meta phase; early calendar morning (00:00–05:00) maps to morning, not evening. */
export function phaseTimeForHour(hour: number): PhaseTime {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "day";
  if (h >= 17 && h < 22) return "evening";
  return "morning";
}

export function greetingPhraseForTimeOfDay(timeOfDay: DialogTimeOfDay, locale: "ru" | "en"): string {
  if (locale === "ru") {
    if (timeOfDay === "morning") return "Доброе утро";
    if (timeOfDay === "midday") return "Добрый день";
    if (timeOfDay === "evening") return "Добрый вечер";
    return "Доброй ночи";
  }
  if (timeOfDay === "morning") return "Good morning";
  if (timeOfDay === "midday") return "Good afternoon";
  if (timeOfDay === "evening") return "Good evening";
  return "Good night";
}

export function dayPartRhetoricInstruction(localHour: number, locale: "ru" | "en"): string {
  if (!isEarlyCalendarMorning(localHour)) return "";
  return locale === "ru"
    ? "Сейчас после полуночи, но календарный день только начался. «Доброй ночи» допустимо, но НЕ пишите, что день «уже вечер», не смешивайте день недели с вечером этого дня, не используйте обороты вроде «самое время спокойно оглядеться» или «подвести итоги дня»."
    : "It is after midnight but the calendar day has just begun. \"Good night\" is fine, but do NOT say the day is \"already evening\", do not pair the weekday with evening, and avoid wind-down phrases like \"time to calmly look back\" or \"wrap up the day\".";
}

export function greetingInstructionForTimeOfDay(
  timeOfDay: DialogTimeOfDay,
  locale: "ru" | "en",
  addressForm: string,
  _localHour: number,
): string {
  const greeting = greetingPhraseForTimeOfDay(timeOfDay, locale);
  if (locale === "ru") {
    return `Если приветствуете, используйте «${greeting}». Не пишите «Привет» при обращении на «${addressForm}». Не смешивайте приветствие с другой частью суток (например «доброй ночи» + «уже вечер»).`;
  }
  return `If you greet, use "${greeting}". Do not mix greetings from different parts of the day.`;
}
