export type ProfileLocale = "ru" | "en";

export interface ProfileReportStrings {
  reportsTitle: string;
  reportsHint: string;
  lifeMatrixTitle: string;
  rangeTrendTitle: string;
  practiceByChakraTitle: string;
  practiceStatsTitle: string;
  spheresLegendPrefix: string;
  groupedTrendPrefix: string;
  groupedTrendEmpty: string;
  practicePieEmpty: string;
  reportsLoading: string;
  reportsUpgradeHint: string;
  openTiersButton: string;
  statsUpgradeHint: string;
  statsLoading: string;
  statsEmpty: string;
}

const ru: ProfileReportStrings = {
  reportsTitle: "Отчёты",
  reportsHint: "Матрица прожитого дня, толщина линии жизни и распределение практик по чакрам.",
  lifeMatrixTitle: "Матрица состояний",
  rangeTrendTitle: "Толщина линии жизни",
  practiceByChakraTitle: "Практики по чакрам",
  practiceStatsTitle: "Статистика практик",
  spheresLegendPrefix: "Сферы:",
  groupedTrendPrefix: "Сгруппированный ряд:",
  groupedTrendEmpty: "пока пусто",
  practicePieEmpty: "За выбранный интервал пока нет завершённых практик с фокусом по чакрам.",
  reportsLoading: "Загружаем отчёты...",
  reportsUpgradeHint: "Отчёты доступны на тарифах Практик и Мастер.",
  openTiersButton: "Открыть тарифы",
  statsUpgradeHint: "Статистика доступна на тарифах Практик и Мастер.",
  statsLoading: "Загружаем статистику...",
  statsEmpty: "Пока нет сохраненных завершенных практик.",
};

const en: ProfileReportStrings = {
  reportsTitle: "Reports",
  reportsHint: "Daily state matrix, life-line thickness, and practice distribution by chakras.",
  lifeMatrixTitle: "State Matrix",
  rangeTrendTitle: "Life Line Thickness",
  practiceByChakraTitle: "Practices by Chakra",
  practiceStatsTitle: "Practice Statistics",
  spheresLegendPrefix: "Spheres:",
  groupedTrendPrefix: "Grouped series:",
  groupedTrendEmpty: "empty for now",
  practicePieEmpty: "No completed chakra-focused practices in the selected interval yet.",
  reportsLoading: "Loading reports...",
  reportsUpgradeHint: "Reports are available on Practitioner and Master tiers.",
  openTiersButton: "View tiers",
  statsUpgradeHint: "Statistics are available on Practitioner and Master tiers.",
  statsLoading: "Loading statistics...",
  statsEmpty: "No saved completed practices yet.",
};

export function getProfileReportStrings(locale: ProfileLocale = "ru"): ProfileReportStrings {
  return locale === "en" ? en : ru;
}
