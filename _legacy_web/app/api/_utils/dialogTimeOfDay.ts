import type { PhaseTime } from "@legacy/app/api/_utils/dialogBranching";
import type { AppContentLocale } from "@legacy/app/api/_utils/contentLocales";
import { SOURCE_LOCALE } from "@legacy/app/api/_utils/contentLocales";
import { getDialogScaffoldStrings, greetingPhrase, interpolate } from "@legacy/app/api/_utils/dialogScaffold";

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

export function greetingPhraseForTimeOfDay(timeOfDay: DialogTimeOfDay, locale: AppContentLocale): string {
  return greetingPhrase(locale, timeOfDay);
}

export function dayPartRhetoricInstruction(localHour: number, locale: AppContentLocale): string {
  if (!isEarlyCalendarMorning(localHour)) return "";
  return getDialogScaffoldStrings(locale).dayPartEarlyMorning;
}

export function greetingInstructionForTimeOfDay(
  timeOfDay: DialogTimeOfDay,
  locale: AppContentLocale,
  addressForm: string,
  _localHour: number,
): string {
  const greeting = greetingPhraseForTimeOfDay(timeOfDay, locale);
  const s = getDialogScaffoldStrings(locale);
  if (locale === SOURCE_LOCALE) {
    return interpolate(s.greetingInstruction, { greeting, addressForm });
  }
  return interpolate(s.greetingInstruction, { greeting });
}
