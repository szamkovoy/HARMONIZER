import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type ChartLocale = AppContentLocale;

export interface ChartStrings {
  balanceLabel: string;
  strengthLabel: string;
}

const ru: ChartStrings = {
  balanceLabel: "баланс",
  strengthLabel: "сила",
};

const en: ChartStrings = {
  balanceLabel: "balance",
  strengthLabel: "strength",
};

export function getChartStrings(locale: ChartLocale = "ru"): ChartStrings {
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  return mergeTypedLocale("charts", base, locale);
}
