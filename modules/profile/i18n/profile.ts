export type ProfileLocale = "ru" | "en";

export interface ProfileReportStrings {
  lifeMatrixTitle: string;
  rangeTrendTitle: string;
  rangeTrendHint: string;
  lifeMatrixHint: string;
  lifeSpheresHint: string;
  lifeStatesHint: string;
  practiceByChakraTitle: string;
  practiceStatsTitle: string;
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
};

const en: ProfileReportStrings = {
  lifeMatrixTitle: "State Matrix",
  rangeTrendTitle: "Life Line Thickness",
  rangeTrendHint:
    "Each point reflects the evenness of your life matrix over 7 days. With regular practice, the graph should move upward.",
  lifeMatrixHint: "Cell color intensity reflects the strength of the corresponding fragments of your psyche",
  lifeSpheresHint: "The significance of different life spheres for you.",
  lifeStatesHint: "Your ability to live through different states. The more even the distribution, the more adequately you interact with the world.",
  practiceByChakraTitle: "Practices by Chakra",
  practiceStatsTitle: "Practice Statistics",
  lifeSpheresTitle: "Life Spheres",
  lifeStatesTitle: "Lived States",
  spheresLegendPrefix: "Life spheres:",
  practicesNotDone: "No practices completed",
  matrixNotReady: "The report will appear after 5 summarized events and 5 days from the first one",
  reportsLoading: "Loading reports...",
  reportsUpgradeHint: "Reports are available on Practitioner and Master tiers.",
  openTiersButton: "View tiers",
  statsUpgradeHint: "Statistics are available on Practitioner and Master tiers.",
  statsLoading: "Loading statistics...",
};

export function getProfileReportStrings(locale: ProfileLocale = "ru"): ProfileReportStrings {
  return locale === "en" ? en : ru;
}
