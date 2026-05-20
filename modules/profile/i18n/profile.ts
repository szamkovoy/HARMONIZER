export type ProfileLocale = "ru" | "en";

export interface ProfileReportStrings {
  lifeMatrixTitle: string;
  rangeTrendTitle: string;
  rangeTrendHint: string;
  practiceByChakraTitle: string;
  practiceStatsTitle: string;
  spheresLegendPrefix: string;
  practicesNotDone: string;
  matrixNotReady: string;
  reportsLoading: string;
  reportsUpgradeHint: string;
  openTiersButton: string;
  statsUpgradeHint: string;
  statsLoading: string;
}

const ru: ProfileReportStrings = {
  lifeMatrixTitle: "Матрица состояний",
  rangeTrendTitle: "Толщина линии жизни",
  rangeTrendHint:
    "Каждая точка — это срез по 5 дням с подытоженным планом. Линия покажет, расширяется ли толщина вашей жизни со временем.",
  practiceByChakraTitle: "Практики по чакрам",
  practiceStatsTitle: "Статистика практик",
  spheresLegendPrefix: "Сферы:",
  practicesNotDone: "Практики не выполнялись",
  matrixNotReady: "Отчёт появится после 5 дней планирований и действий",
  reportsLoading: "Загружаем отчёты...",
  reportsUpgradeHint: "Отчёты доступны на тарифах Практик и Мастер.",
  openTiersButton: "Открыть тарифы",
  statsUpgradeHint: "Статистика доступна на тарифах Практик и Мастер.",
  statsLoading: "Загружаем статистику...",
};

const en: ProfileReportStrings = {
  lifeMatrixTitle: "State Matrix",
  rangeTrendTitle: "Life Line Thickness",
  rangeTrendHint:
    "Each point summarizes five days with a completed plan. The line shows whether the thickness of your life is expanding over time.",
  practiceByChakraTitle: "Practices by Chakra",
  practiceStatsTitle: "Practice Statistics",
  spheresLegendPrefix: "Spheres:",
  practicesNotDone: "No practices completed",
  matrixNotReady: "The report will appear after 5 days of planning and action",
  reportsLoading: "Loading reports...",
  reportsUpgradeHint: "Reports are available on Practitioner and Master tiers.",
  openTiersButton: "View tiers",
  statsUpgradeHint: "Statistics are available on Practitioner and Master tiers.",
  statsLoading: "Loading statistics...",
};

export function getProfileReportStrings(locale: ProfileLocale = "ru"): ProfileReportStrings {
  return locale === "en" ? en : ru;
}
