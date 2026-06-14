import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type SymbolStreamLocale = AppContentLocale;

export interface SymbolStreamStrings {
  locale: SymbolStreamLocale;
  title: string;
  description: string;
  remaining: (time: string) => string;
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

export function getSymbolStreamStrings(locale: SymbolStreamLocale = "ru"): SymbolStreamStrings {
  const base = locale === "en" ? en : ru;
  return mergeTypedLocale("mandala", base, locale);
}
