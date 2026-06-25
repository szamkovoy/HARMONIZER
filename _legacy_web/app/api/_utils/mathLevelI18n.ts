import type { AppContentLocale } from "./contentLocales";

export type MathLevelStrings = {
  title: string;
  intro: string;
  section1Title: string;
  formulaS: string;
  formulaH: string;
  chakraLabel: (n: number) => string;
  natalS: string;
  natalH: string;
  calibratedS: (value: string, delta: string) => string;
  calibratedH: (value: string, delta: string) => string;
  section2Title: string;
  section2Intro: string;
  transitLine: (transit: string, aspect: string, natal: string) => string;
  orbLine: (orb: string, coef: string, weight: string) => string;
  activationLine: (value: string) => string;
  noTransitChart: string;
  section3Title: string;
  section3Formula: string;
  section3Intro: string;
  importanceLine: (planet: string, activation: string, sEff: string, importance: string) => string;
  section4Title: string;
  winnerLine: (planet: string, importance: string) => string;
  alternativeLine: (reason: string) => string;
  section5Title: string;
  calibrationIntro: (version: string, source: string, blend: string) => string;
  deltaLine: (planet: string, dS: string, dH: string) => string;
  globalTitle: string;
  globalIntro: string;
  globalSectionPetals: string;
  globalPetalLine: (planet: string, gravity: number, chakra: number, tone: string) => string;
  globalMechanicsLine: string;
  globalSectionWinner: string;
  globalWinnerLine: (planet: string, chakra: number, tone: string, gravity: string) => string;
  globalSectionRanking: string;
  globalRankingLine: (rank: string, planet: string, sign: string, degree: string, gravity: string, tone: string) => string;
  globalSectionAspects: string;
  globalAspectLine: (from: string, type: string, to: string, orb: string) => string;
  globalSectionAspectWeights: string;
  globalAspectWeightLine: (from: string, type: string, to: string, orb: string, weight: string) => string;
};

const ru: MathLevelStrings = {
  title: "## Математика дня\n",
  intro:
    "Здесь — точный расчёт того, что вы видите на главной странице. Используются методы древнегреческой астрологии (эссенциальные достоинства Птолемея, акцидентальные по Лилли), скорректированные под современную психологическую модель чакр.\n",
  section1Title: "\n### 1. Сила (S) и гармоничность (H) планет\n",
  formulaS:
    "**Формула S:** комбинация эссенциальных достоинств и акцидентальных факторов. Нормализуется в диапазон [0, 1].\n",
  formulaH:
    "**Формула H:** взвешенная сумма гармонизирующих и напряжённых факторов планеты. Нормализуется в диапазон [-1, +1].\n",
  chakraLabel: (n) => `(чакра ${n})`,
  natalS: "S натальная",
  natalH: "H натальная",
  calibratedS: (value, delta) => `S калиброванная: ${value} (Δ${delta})`,
  calibratedH: (value, delta) => `H калиброванная: ${value} (Δ${delta})`,
  section2Title: "\n### 2. Активирующие транзиты сегодня\n",
  section2Intro:
    "Транзитная планета вступает в аспект с натальной — это активация темы натальной планеты на день. Вес транзита зависит от его медленности, точности орба и типа аспекта.\n",
  transitLine: (transit, aspect, natal) => `\n- Транзитный **${transit}** ${aspect} к натальному **${natal}**`,
  orbLine: (orb, coef, weight) => `  - Орб: ${orb}°, коэф. аспекта: ${coef}, вес транзита: ${weight}`,
  activationLine: (value) => `  - Активация: ${value}`,
  noTransitChart: "\nТранзитная карта в сохранённом прогнозе отсутствует, поэтому список аспектов недоступен.",
  section3Title: "\n### 3. Importance — формула выбора планеты дня\n",
  section3Formula: "**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n",
  section3Intro:
    "Где `Activation` — суммарный вес активирующих транзитов; `S_eff` — эффективная сила (S_calibrated если есть калибровка, иначе S_initial).\n",
  importanceLine: (planet, activation, sEff, importance) =>
    `- **${planet}**: Activation=${activation} × (0.5 + 0.5 × ${sEff}) = **${importance}**`,
  section4Title: "\n### 4. Выбор планеты дня",
  winnerLine: (planet, importance) => `Победитель: **${planet}** (Importance = ${importance}).\n`,
  alternativeLine: (reason) => `Использован альтернативный выбор: ${reason}.`,
  section5Title: "\n### 5. Дельты калибровки\n",
  calibrationIntro: (version, source, blend) =>
    `Калибровка v${version}, источник: ${source}. Применённое усреднение: ${blend}.\n`,
  deltaLine: (planet, dS, dH) => `- ${planet}: ΔS=${dS}, ΔH=${dH}`,
  globalTitle: "## Математика общего прогноза\n",
  globalIntro:
    "Общий прогноз строится без натальной карты: учитываются только транзитные положения семи планет на 12:00 UTC выбранного дня.",
  globalSectionPetals: "\n### Топ-3 лепестка\n",
  globalPetalLine: (planet, gravity, chakra, tone) =>
    `- **${planet}**: gravity=${gravity}, chakra ${chakra}, tone=${tone}`,
  globalMechanicsLine:
    "Каждая планета получает gravity-оценку: суммируется вклад аспектов с поправкой на тип аспекта, точность орба и «вес» самой транзитной планеты.",
  globalSectionWinner: "\n### Почему выбрана именно эта тема дня\n",
  globalWinnerLine: (planet, chakra, tone, gravity) =>
    `- Главная тема дня: **${planet}** (чакра ${chakra}, tone=${tone}, gravity=${gravity}). Именно эта планета набрала максимальный суммарный вес среди транзитов дня.`,
  globalSectionRanking: "\n### Полный рейтинг планет на этот момент\n",
  globalRankingLine: (rank, planet, sign, degree, gravity, tone) =>
    `${rank}. **${planet}** — ${sign} ${degree}°, gravity=${gravity}, tone=${tone}`,
  globalSectionAspects: "\n### Активные аспекты дня\n",
  globalAspectLine: (from, type, to, orb) => `- ${from} ${type} ${to}, orb=${orb}°`,
  globalSectionAspectWeights: "\n### Вес каждого аспекта в общей картине\n",
  globalAspectWeightLine: (from, type, to, orb, weight) =>
    `- ${from} ${type} ${to}: orb=${orb}°, contribution=${weight}`,
};

const en: MathLevelStrings = {
  title: "## Day mathematics\n",
  intro:
    "Here is the exact calculation behind what you see on the home screen. We use ancient Greek astrology methods (Ptolemy's essential dignities, Lilly's accidentals), adjusted for the modern psychological chakra model.\n",
  section1Title: "\n### 1. Planetary strength (S) and harmony (H)\n",
  formulaS:
    "**Formula S:** a combination of essential dignities and accidental factors, normalized to [0, 1].\n",
  formulaH:
    "**Formula H:** a weighted sum of harmonizing and tense factors, normalized to [-1, +1].\n",
  chakraLabel: (n) => `(chakra ${n})`,
  natalS: "natal S",
  natalH: "natal H",
  calibratedS: (value, delta) => `calibrated S: ${value} (Δ${delta})`,
  calibratedH: (value, delta) => `calibrated H: ${value} (Δ${delta})`,
  section2Title: "\n### 2. Activating transits today\n",
  section2Intro:
    "When a transiting planet aspects a natal one, it activates that natal theme for the day. Transit weight depends on speed, orb tightness, and aspect type.\n",
  transitLine: (transit, aspect, natal) => `\n- Transiting **${transit}** ${aspect} natal **${natal}**`,
  orbLine: (orb, coef, weight) => `  - Orb: ${orb}°, aspect coef: ${coef}, transit weight: ${weight}`,
  activationLine: (value) => `  - Activation: ${value}`,
  noTransitChart: "\nThe saved forecast has no transit chart, so aspects are unavailable.",
  section3Title: "\n### 3. Importance — planet-of-the-day formula\n",
  section3Formula: "**Importance(P) = Activation(P) × (0.5 + 0.5 × S_eff(P))**\n",
  section3Intro:
    "Where `Activation` is the total weight of activating transits; `S_eff` is effective strength (S_calibrated when calibration exists, otherwise S_initial).\n",
  importanceLine: (planet, activation, sEff, importance) =>
    `- **${planet}**: Activation=${activation} × (0.5 + 0.5 × ${sEff}) = **${importance}**`,
  section4Title: "\n### 4. Planet of the day",
  winnerLine: (planet, importance) => `Winner: **${planet}** (Importance = ${importance}).\n`,
  alternativeLine: (reason) => `Alternative choice used: ${reason}.`,
  section5Title: "\n### 5. Calibration deltas\n",
  calibrationIntro: (version, source, blend) =>
    `Calibration v${version}, source: ${source}. Blend applied: ${blend}.\n`,
  deltaLine: (planet, dS, dH) => `- ${planet}: ΔS=${dS}, ΔH=${dH}`,
  globalTitle: "## Global forecast mathematics\n",
  globalIntro:
    "The global forecast is built without a natal chart: only transit positions of the seven planets at 12:00 UTC for the selected day are used.",
  globalSectionPetals: "\n### Top 3 petals\n",
  globalPetalLine: (planet, gravity, chakra, tone) =>
    `- **${planet}**: gravity=${gravity}, chakra ${chakra}, tone=${tone}`,
  globalMechanicsLine:
    "Each planet receives a gravity score: we sum aspect contributions adjusted by aspect type, orb tightness, and the weight of the transiting planet itself.",
  globalSectionWinner: "\n### Why this became the theme of the day\n",
  globalWinnerLine: (planet, chakra, tone, gravity) =>
    `- Main theme of the day: **${planet}** (chakra ${chakra}, tone=${tone}, gravity=${gravity}). It received the highest total weight among today's transits.`,
  globalSectionRanking: "\n### Full planetary ranking for this moment\n",
  globalRankingLine: (rank, planet, sign, degree, gravity, tone) =>
    `${rank}. **${planet}** — ${sign} ${degree}°, gravity=${gravity}, tone=${tone}`,
  globalSectionAspects: "\n### Active aspects of the day\n",
  globalAspectLine: (from, type, to, orb) => `- ${from} ${type} ${to}, orb=${orb}°`,
  globalSectionAspectWeights: "\n### Weight of each aspect in the overall picture\n",
  globalAspectWeightLine: (from, type, to, orb, weight) =>
    `- ${from} ${type} ${to}: orb=${orb}°, contribution=${weight}`,
};

import {
  mathLevelDe,
  mathLevelEs,
  mathLevelFr,
  mathLevelIt,
  mathLevelNl,
  mathLevelPt,
} from "./mathLevelI18nTargets";

export function getMathLevelStrings(locale: AppContentLocale = "ru"): MathLevelStrings {
  if (locale === "ru") return ru;
  if (locale === "en") return en;
  if (locale === "it") return mathLevelIt;
  if (locale === "de") return mathLevelDe;
  if (locale === "fr") return mathLevelFr;
  if (locale === "es") return mathLevelEs;
  if (locale === "pt") return mathLevelPt;
  if (locale === "nl") return mathLevelNl;
  return en;
}
