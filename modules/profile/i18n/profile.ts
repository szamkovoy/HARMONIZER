import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type ProfileLocale = AppContentLocale;

export interface ProfileReportStrings {
  lifeMatrixTitle: string;
  rangeTrendTitle: string;
  rangeTrendHint: string;
  lifeMatrixHint: string;
  lifeSpheresHint: string;
  lifeStatesHint: string;
  practiceByChakraTitle: string;
  practiceStatsTitle: string;
  practiceStatsUnitHint: string;
  practiceStatsWeeklyHint: string;
  practiceStatsScrubTotalLabel: string;
  practiceStatsMinutesUnit: string;
  lifeSpheresTitle: string;
  lifeStatesTitle: string;
  spheresLegendPrefix: string;
  practicesNotDone: string;
  matrixNotReady: string;
  reportsLoading: string;
  reportsUpgradeHint: string;
  openTiersButton: string;
  statsUpgradeHint: string;
  statsLoading: string;
  periodPreset7d: string;
  periodPreset30d: string;
  periodPreset90d: string;
  reportLoadError: string;
  projectionLoading: string;
}

const ru: ProfileReportStrings = {
  lifeMatrixTitle: "Матрица состояний",
  rangeTrendTitle: "Толщина линии жизни",
  rangeTrendHint:
    "Каждая точка графика отражает равномерность бистохастической матрицы вашей жизни за 7 дней. В результате регулярных практик график должен двигаться вверх.",
  lifeMatrixHint: "Насыщенность цветов клеток отражает силу соответствующих фрагментов вашей психики",
  lifeSpheresHint: "Значимость для вас различных сфер жизни.",
  lifeStatesHint: "Ваша способность проживать различные состояния. Чем равномерней распределение, тем адекватней вы взаимодействуете с миром.",
  practiceByChakraTitle: "Практики по чакрам",
  practiceStatsTitle: "Статистика практик",
  practiceStatsUnitHint: "К-во минут практик за день",
  practiceStatsWeeklyHint: "Среднее к-во минут практик за день в неделю",
  practiceStatsScrubTotalLabel: "Всего",
  practiceStatsMinutesUnit: "мин",
  lifeSpheresTitle: "Сферы жизни",
  lifeStatesTitle: "Проживаемые состояния",
  spheresLegendPrefix: "Сферы жизни:",
  practicesNotDone: "Практики не выполнялись",
  matrixNotReady: "Отчёт появится после 5 подытоженных событий и 5 дней от первого из них",
  reportsLoading: "Загружаем отчёты...",
  reportsUpgradeHint: "Отчёты доступны на тарифах Практик и Мастер.",
  openTiersButton: "Открыть тарифы",
  statsUpgradeHint: "Статистика доступна на тарифах Практик и Мастер.",
  statsLoading: "Загружаем статистику...",
  periodPreset7d: "7д",
  periodPreset30d: "30д",
  periodPreset90d: "90д",
  reportLoadError: "Не удалось загрузить отчёт.",
  projectionLoading: "Загрузка...",
};

const en: ProfileReportStrings = {
  lifeMatrixTitle: "State matrix",
  rangeTrendTitle: "Life line thickness",
  rangeTrendHint:
    "Each point reflects the evenness of your life matrix over 7 days. With regular practice, the graph should move upward.",
  lifeMatrixHint: "Cell color intensity reflects the strength of the corresponding fragments of your psyche",
  lifeSpheresHint: "The significance of different life spheres for you.",
  lifeStatesHint: "Your ability to live through different states. The more even the distribution, the more adequately you interact with the world.",
  practiceByChakraTitle: "Practices by chakra",
  practiceStatsTitle: "Practice statistics",
  practiceStatsUnitHint: "Practice minutes per day",
  practiceStatsWeeklyHint: "Average practice minutes per day per week",
  practiceStatsScrubTotalLabel: "Total",
  practiceStatsMinutesUnit: "min",
  lifeSpheresTitle: "Life spheres",
  lifeStatesTitle: "States lived",
  spheresLegendPrefix: "Life spheres:",
  practicesNotDone: "No practices completed",
  matrixNotReady: "The report will appear after 5 summarized events and 5 days from the first one",
  reportsLoading: "Loading reports...",
  reportsUpgradeHint: "Reports are available on Practitioner and Master tiers.",
  openTiersButton: "View tiers",
  statsUpgradeHint: "Statistics are available on Practitioner and Master tiers.",
  statsLoading: "Loading statistics...",
  periodPreset7d: "7d",
  periodPreset30d: "30d",
  periodPreset90d: "90d",
  reportLoadError: "Could not load the report.",
  projectionLoading: "Loading...",
};

export function getPeriodPresets(locale: ProfileLocale = "ru") {
  const strings = getProfileReportStrings(locale);
  return [
    { id: "7d" as const, label: strings.periodPreset7d, days: 7 },
    { id: "30d" as const, label: strings.periodPreset30d, days: 30 },
    { id: "90d" as const, label: strings.periodPreset90d, days: 90 },
  ];
}

export function getProfileReportStrings(locale: ProfileLocale = "ru"): ProfileReportStrings {
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  return mergeTypedLocale("profile", base, locale);
}
