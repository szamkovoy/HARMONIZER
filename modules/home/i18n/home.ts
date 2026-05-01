import type { AspectType, DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import { PLANET_CHAKRA } from "@/modules/home/planetChakra";

export type HomeLocale = "ru" | "en";

type ForecastWithRecommendation = DailyForecast & {
  recommendationShortText?: string;
};

export interface HomeStrings {
  locale: HomeLocale;
  appTitle: string;
  headerHint: string;
  daySlogan: (forecast?: DailyForecast | null) => string;
  refreshButton: string;
  refreshAccessibilityLabel: string;
  refreshingLabel: string;
  sourceLabel: (source: "cache" | "computed") => string;
  skeletonText: string;
  locationErrorTitle: string;
  locationErrorMessage: string;
  forecastErrorTitle: string;
  retryButton: string;
  emptyTimeLabel: string;
  assistantTitle: string;
  closeButton: string;
  closeAssistantAccessibilityLabel: string;
  signOutButton: string;
  signingOutButton: string;
  defaultSystemPrompt: string;
  discussInitialMessage: (forecast: DailyForecast) => string;
  planetLabels: Record<Planet, string>;
  toneLabels: Record<TodayTone, string>;
  toneRecommendationVerb: Record<TodayTone, string>;
  chakraFlower: {
    title: string;
    caption: string;
  };
  planetBanner: {
    eyebrow: string;
    title: (planet: string) => string;
    chakraLine: (chakraNumber: number, chakraName: string) => string;
    toneLine: (tone: string, label: string) => string;
  };
  opportunityWindows: {
    title: string;
    subtitle: (planet: string) => string;
    emptyDetail: string;
    windowTitles: Record<"sunrise" | "culmination" | "exactAspect", string>;
    aspectLabels: Record<AspectType, string>;
    sunriseDetail: (planet: string) => string;
    culminationDetail: (planet: string) => string;
    exactAspectDetail: (aspect: string, planet: string) => string;
  };
  recommendation: {
    title: string;
    meta: (planet: string, chakraName: string) => string;
    fallback: (forecast: DailyForecast) => string;
    discussButton: string;
  };
  eventBells: {
    title: string;
    empty: string;
    aspectTitle: string;
  };
  devLinks: Record<string, string>;
  formatTime: (value: string) => string;
}

function formatTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const ruPlanetLabels: Record<Planet, string> = {
  Sun: "Солнце",
  Moon: "Луна",
  Mercury: "Меркурий",
  Venus: "Венера",
  Mars: "Марс",
  Jupiter: "Юпитер",
  Saturn: "Сатурн",
};

const enPlanetLabels: Record<Planet, string> = {
  Sun: "Sun",
  Moon: "Moon",
  Mercury: "Mercury",
  Venus: "Venus",
  Mars: "Mars",
  Jupiter: "Jupiter",
  Saturn: "Saturn",
};

const ru: HomeStrings = {
  locale: "ru",
  appTitle: "Harmonizer",
  headerHint: "Главная настройка дня: чакры, окна возможностей и практическая рекомендация.",
  daySlogan: (forecast) => {
    if (!forecast) return "Настройся бережно и выбери один ясный шаг.";
    if (forecast.slogan?.trim()) return forecast.slogan.trim();
    const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
    return meta.chakraNumber === 7 ? "Соберите внимание вокруг главного" : `Мягко держите фокус: ${meta.label}`;
  },
  refreshButton: "Обновить",
  refreshAccessibilityLabel: "Обновить прогноз дня",
  refreshingLabel: "...",
  sourceLabel: (source) => `Источник: ${source === "cache" ? "кеш" : "новый расчёт"}`,
  skeletonText: "Собираю прогноз дня и окна возможностей...",
  locationErrorTitle: "Нужна геолокация",
  locationErrorMessage:
    "Для расчёта окон возможностей нужна геолокация. Разрешите её в настройках профиля или пройдите онбординг заново.",
  forecastErrorTitle: "Не удалось загрузить прогноз",
  retryButton: "Повторить",
  emptyTimeLabel: "—",
  assistantTitle: "Ассистент",
  closeButton: "Закрыть",
  closeAssistantAccessibilityLabel: "Закрыть ассистента",
  signOutButton: "Выход",
  signingOutButton: "Выходим...",
  defaultSystemPrompt: "Ты эмпатичный наставник приложения Harmonizer. Отвечай кратко и по делу.",
  discussInitialMessage: (forecast) => {
    const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
    return [
      "Хочу обсудить рекомендацию дня и подобрать практику.",
      "",
      "Контекст прогноза:",
      `- планета дня: ${ruPlanetLabels[forecast.planetOfTheDay]}`,
      `- чакра: ${meta.chakraName} (${meta.label})`,
      `- тональность: ${ru.toneLabels[forecast.todayPlanetState.todayTone]}`,
    ].join("\n");
  },
  planetLabels: ruPlanetLabels,
  toneLabels: {
    harmonic: "гармоничный",
    neutral: "нейтральный",
    dissonant: "напряжённый",
  },
  toneRecommendationVerb: {
    harmonic: "мягко усилить",
    neutral: "спокойно настроить",
    dissonant: "бережно стабилизировать",
  },
  chakraFlower: {
    title: "Цветок дня",
    caption: "Размер лепестков отражает важность чакр на сегодня.",
  },
  planetBanner: {
    eyebrow: "Планета дня",
    title: (planet) => planet,
    chakraLine: (chakraNumber, chakraName) => `${chakraNumber} чакра · ${chakraName}`,
    toneLine: (tone, label) => `${tone} тон · ${label}`,
  },
  opportunityWindows: {
    title: "Окно возможностей",
    subtitle: (planet) => `Главная тема: ${planet}`,
    emptyDetail: "Сегодня без точного окна",
    windowTitles: {
      sunrise: "Восход",
      culmination: "Кульминация",
      exactAspect: "Точный аспект",
    },
    aspectLabels: {
      conjunction: "соединение",
      opposition: "оппозиция",
      square: "квадрат",
      trine: "трин",
      sextile: "секстиль",
    },
    sunriseDetail: (planet) => `${planet} поднимается над горизонтом`,
    culminationDetail: (planet) => `${planet} в максимальной силе`,
    exactAspectDetail: (aspect, planet) => `${aspect} к ${planet}`,
  },
  recommendation: {
    title: "Рекомендации на день",
    meta: (planet, chakraName) => `${planet} · ${chakraName}`,
    fallback: (forecast) => {
      const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
      const verb = ru.toneRecommendationVerb[forecast.todayPlanetState.todayTone];
      return `Сегодня держите фокус на теме «${meta.label}»: не распыляйтесь, не доказывайте лишнего и не пытайтесь ускорять процессы силой. Полезнее выбрать один ясный шаг, ${verb} ${meta.chakraName.toLowerCase()} через тело и дыхание, а в сложных разговорах сначала возвращаться к спокойному ритму. Так день станет не прогнозом, а понятным планом действий.`;
    },
    discussButton: "Что делать?",
  },
  eventBells: {
    title: "Колокольчики",
    empty: "На сегодня нет предстоящих астро-событий с точным временем.",
    aspectTitle: "Аспект",
  },
  devLinks: {
    biofeedback: "Biofeedback",
    mandala: "Mandala",
    bindu: "Bindu",
    symbols: "Symbols",
    breath: "Breath",
    calibration: "Calibration",
  },
  formatTime: (value) => formatTime(value, "ru"),
};

const en: HomeStrings = {
  ...ru,
  locale: "en",
  headerHint: "Daily tuning: chakras, opportunity windows, and a gentle recommendation.",
  daySlogan: (forecast) => {
    if (!forecast) return "Tune gently and choose one clear step.";
    if (forecast.slogan?.trim()) return forecast.slogan.trim();
    const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
    return `Today: ${meta.label}. Gather attention around what matters.`;
  },
  refreshButton: "Refresh",
  refreshAccessibilityLabel: "Refresh daily forecast",
  sourceLabel: (source) => `Source: ${source === "cache" ? "cache" : "new calculation"}`,
  skeletonText: "Preparing the daily forecast and opportunity windows...",
  locationErrorTitle: "Location is required",
  locationErrorMessage:
    "Opportunity windows need your location. Allow it in profile settings or repeat onboarding.",
  forecastErrorTitle: "Could not load forecast",
  retryButton: "Try again",
  emptyTimeLabel: "—",
  assistantTitle: "Assistant",
  closeButton: "Close",
  closeAssistantAccessibilityLabel: "Close assistant",
  signOutButton: "Sign out",
  signingOutButton: "Signing out...",
  defaultSystemPrompt: "You are an empathetic Harmonizer mentor. Reply briefly and practically.",
  discussInitialMessage: (forecast) => {
    const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
    return [
      "I want to discuss today's recommendation and choose a practice.",
      "",
      "Forecast context:",
      `- planet of the day: ${enPlanetLabels[forecast.planetOfTheDay]}`,
      `- chakra: ${meta.chakraName} (${meta.label})`,
      `- tone: ${en.toneLabels[forecast.todayPlanetState.todayTone]}`,
    ].join("\n");
  },
  planetLabels: enPlanetLabels,
  toneLabels: {
    harmonic: "harmonic",
    neutral: "neutral",
    dissonant: "tense",
  },
  toneRecommendationVerb: {
    harmonic: "gently strengthen",
    neutral: "calmly tune",
    dissonant: "carefully stabilize",
  },
  chakraFlower: {
    title: "State flower",
    caption: "Petal size reflects today's chakra importance.",
  },
  planetBanner: {
    eyebrow: "Planet of the Day",
    title: (planet) => planet,
    chakraLine: (chakraNumber, chakraName) => `Chakra ${chakraNumber} · ${chakraName}`,
    toneLine: (tone, label) => `${tone} tone · ${label}`,
  },
  opportunityWindows: {
    title: "Opportunity windows",
    subtitle: (planet) => `Main theme: ${planet}`,
    emptyDetail: "No exact window today",
    windowTitles: {
      sunrise: "Rise",
      culmination: "Culmination",
      exactAspect: "Exact aspect",
    },
    aspectLabels: {
      conjunction: "conjunction",
      opposition: "opposition",
      square: "square",
      trine: "trine",
      sextile: "sextile",
    },
    sunriseDetail: (planet) => `${planet} rises above the horizon`,
    culminationDetail: (planet) => `${planet} is at peak strength`,
    exactAspectDetail: (aspect, planet) => `${aspect} to ${planet}`,
  },
  recommendation: {
    title: "Daily recommendation",
    meta: (planet, chakraName) => `${planet} · ${chakraName}`,
    fallback: (forecast) => {
      const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
      const verb = en.toneRecommendationVerb[forecast.todayPlanetState.todayTone];
      return `Today it may help to ${verb} ${meta.chakraName}: bring attention to "${meta.label}" and choose a practice without rushing.`;
    },
    discussButton: "Discuss with assistant",
  },
  eventBells: {
    title: "Bells",
    empty: "There are no upcoming timed astro-events today.",
    aspectTitle: "Aspect",
  },
  formatTime: (value) => formatTime(value, "en"),
};

export function getHomeStrings(locale: HomeLocale): HomeStrings {
  return locale === "en" ? en : ru;
}

export function getForecastRecommendation(forecast: DailyForecast, strings: HomeStrings): string {
  const withText = forecast as ForecastWithRecommendation;
  return withText.recommendationShortText?.trim() || strings.recommendation.fallback(forecast);
}
