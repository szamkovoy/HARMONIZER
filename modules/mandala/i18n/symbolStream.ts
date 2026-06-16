import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type SymbolStreamLocale = AppContentLocale;

export interface SymbolStreamStrings {
  locale: SymbolStreamLocale;
  title: string;
  description: string;
  remaining: (time: string) => string;
  densityAiry: string;
  densityBalanced: string;
  densityDense: string;
  finishButton: string;
  pauseButton: string;
  resumeButton: string;
  newLineButton: string;
  nextMandalaButton: string;
  finishA11y: string;
  stopConfirmTitle: string;
  stopConfirmMessage: string;
  continueButton: string;
  ratingTitle: string;
  ratingMessage: string;
  moodBetter: string;
  moodSame: string;
  moodWorse: string;
}

const ru: SymbolStreamStrings = {
  locale: "ru",
  title: "Вспышка",
  description: "Короткая визуальная медитация для мягкого переключения внимания и гармонизации.",
  remaining: (time) => `Осталось ${time}`,
  densityAiry: "Легко",
  densityBalanced: "Баланс",
  densityDense: "Плотно",
  finishButton: "Завершить",
  pauseButton: "Пауза",
  resumeButton: "Продолжить",
  newLineButton: "Новая линия",
  nextMandalaButton: "Следующая мандала",
  finishA11y: "Завершить практику",
  stopConfirmTitle: "Завершить практику?",
  stopConfirmMessage: "Можно остановиться сейчас и отметить, как вы себя чувствуете после практики.",
  continueButton: "Продолжить",
  ratingTitle: "Как вы себя чувствуете?",
  ratingMessage: "Эта оценка поможет позже лучше подбирать практики.",
  moodBetter: "Лучше",
  moodSame: "Так же",
  moodWorse: "Хуже",
};

const en: SymbolStreamStrings = {
  locale: "en",
  title: "Flash",
  description: "A short visual meditation for a gentle shift of attention and harmonization.",
  remaining: (time) => `${time} remaining`,
  densityAiry: "Airy",
  densityBalanced: "Balanced",
  densityDense: "Dense",
  finishButton: "Finish",
  pauseButton: "Pause",
  resumeButton: "Resume",
  newLineButton: "New line",
  nextMandalaButton: "Next mandala",
  finishA11y: "Finish practice",
  stopConfirmTitle: "Finish practice?",
  stopConfirmMessage: "You can stop now and note how you feel after the practice.",
  continueButton: "Continue",
  ratingTitle: "How do you feel?",
  ratingMessage: "This rating helps us suggest better practices later.",
  moodBetter: "Better",
  moodSame: "Same",
  moodWorse: "Worse",
};

function remainingForLocale(locale: SymbolStreamLocale, time: string): string {
  switch (locale) {
    case "ru":
      return `Осталось ${time}`;
    case "de":
      return `Noch ${time}`;
    case "fr":
      return `Encore ${time}`;
    case "it":
      return `Ancora ${time}`;
    case "es":
      return `Quedan ${time}`;
    case "pt":
      return `Faltam ${time}`;
    case "nl":
      return `Nog ${time}`;
    default:
      return `${time} remaining`;
  }
}

export function getSymbolStreamStrings(locale: SymbolStreamLocale = "ru"): SymbolStreamStrings {
  const base = locale === "ru" ? ru : en;
  const merged = mergeTypedLocale("mandala", base, locale);
  return {
    ...merged,
    remaining: (time: string) => remainingForLocale(locale, time),
  };
}
