import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";
import type { AspectType, DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import { chakraLabelGenitive, type ChakraLocale } from "@/modules/chakra/i18n";
import { getPlanetChakraMap } from "@/modules/home/planetChakra";
import type { LocationAcquireFailureReason } from "@/modules/location/acquireAndPersistUserCoordinates";

export type HomeLocale = AppContentLocale;

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
  locationErrorPermissionMessage: string;
  locationErrorTimeoutMessage: string;
  openSettingsButton: string;
  birthDataTitle: string;
  birthDataMessage: string;
  staleContentTitle: string;
  staleContentMessage: string;
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
    /** Платный тариф: движение транзитной планеты может отличаться от планеты дня. */
    graphTrack: (planet: string) => string;
    emptyDetail: string;
    windowTitles: Record<"sunrise" | "culmination" | "exactAspect", string>;
    aspectLabels: Record<AspectType, string>;
    sunriseDetail: (planet: string) => string;
    culminationDetail: (planet: string) => string;
    exactAspectDetail: (aspect: string, planet: string) => string;
    reminderModalTitle: string;
    reminderTextLabel: string;
    reminderModeExact: string;
    reminderModeBefore5: string;
    reminderSave: string;
    reminderCancel: string;
    reminderBodyFiveMinPrefix: string;
    reminderPastTitle: string;
    reminderPastMessage: string;
    reminderNotificationsUnavailableTitle: string;
    reminderNotificationsUnavailableMessage: string;
    reminderNeedPermissionTitle: string;
    reminderNeedPermissionMessage: string;
    helpButtonAccessibilityLabel: string;
    helpModalTitle: string;
    helpLoading: string;
  };
  recommendation: {
    title: string;
    meta: (planet: string, chakraName: string) => string;
    fallback: (forecast: DailyForecast) => string;
    discussButton: string;
    readMoreButton: string;
    detailParagraphs: (forecast: DailyForecast) => string[];
  };
  longExplanationModal: {
    title: string;
    subtitle: string;
    closeButton: string;
    mathButton: string;
    mathButtonA11y: string;
    mathCaption: string;
  };
  eventBells: {
    title: string;
    empty: string;
    aspectTitle: string;
  };
  devLinks: Record<string, string>;
  /** Кнопка в тестовом ряду: POST global-content { devReset: true } + refresh */
  devResetDayContent: string;
  freeTierBanner: string;
  mathModal: {
    title: string;
    subtitle: string;
    closeButton: string;
    emptyHint: string;
    showChartButton: string;
    chartUnavailableHint: string;
  };
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
    const meta = getPlanetChakraMap("ru")[forecast.planetOfTheDay];
    return meta.chakraNumber === 7 ? "Соберите внимание вокруг главного" : `Мягко держите фокус: ${meta.label}`;
  },
  refreshButton: "Обновить",
  refreshAccessibilityLabel: "Обновить прогноз дня",
  refreshingLabel: "...",
  sourceLabel: (source) => `Источник: ${source === "cache" ? "кеш" : "новый расчёт"}`,
  skeletonText: "Собираю прогноз дня и окна возможностей...",
  locationErrorTitle: "Нужна геолокация",
  locationErrorMessage:
    "Для расчёта окон возможностей нужна геолокация. Разрешите доступ к геопозиции и попробуйте снова.",
  locationErrorPermissionMessage:
    "Доступ к геопозиции выключен. Откройте настройки приложения, разрешите геолокацию и вернитесь сюда.",
  locationErrorTimeoutMessage:
    "Не удалось быстро определить местоположение. Проверьте GPS или Wi‑Fi и попробуйте снова.",
  openSettingsButton: "Открыть настройки",
  birthDataTitle: "Нужна дата рождения",
  birthDataMessage: "Чтобы построить персональный прогноз дня, введите дату, время и место рождения.",
  staleContentTitle: "Показываю сохранённый прогноз",
  staleContentMessage: "Свежие данные сейчас не загрузились, поэтому временно показываю последний сохранённый вариант за этот день.",
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
    const meta = getPlanetChakraMap("ru")[forecast.planetOfTheDay];
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
    chakraLine: (_chakraNumber, chakraName) => chakraName,
    toneLine: (tone, label) => `${tone} тон · ${label}`,
  },
  opportunityWindows: {
    title: "Окно возможностей",
    subtitle: (planet) => `Главная тема: ${planet}`,
    graphTrack: (planet) => `На графике: ${planet}`,
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
    reminderModalTitle: "Уведомить",
    reminderTextLabel: "Текст уведомления",
    reminderModeExact: "точно в это время",
    reminderModeBefore5: "за 5 минут до",
    reminderSave: "Сохранить",
    reminderCancel: "Отмена",
    reminderBodyFiveMinPrefix: "За 5 минут до",
    reminderPastTitle: "Время уже прошло",
    reminderPastMessage: "Для прошедшего окна уведомление поставить нельзя.",
    reminderNotificationsUnavailableTitle: "Уведомления пока недоступны",
    reminderNotificationsUnavailableMessage:
      "Текущая сборка приложения запущена без native-модуля уведомлений. После новой dev/release-сборки колокольчики смогут ставить системные уведомления.",
    reminderNeedPermissionTitle: "Нужны уведомления",
    reminderNeedPermissionMessage: "Разрешите уведомления, чтобы Harmonizer мог напомнить об окне возможностей.",
    helpButtonAccessibilityLabel: "Пояснение к графику окна возможностей",
    helpModalTitle: "Как читать это окно",
    helpLoading: "Собираю пояснение...",
  },
  recommendation: {
    title: "Рекомендации на день",
    meta: (planet, chakraName) => `${planet} · ${chakraName}`,
    fallback: (forecast) => {
      const meta = getPlanetChakraMap("ru")[forecast.planetOfTheDay];
      const verb = ru.toneRecommendationVerb[forecast.todayPlanetState.todayTone];
      return `Сегодня держите фокус на теме «${meta.label}»: не распыляйтесь, не доказывайте лишнего и не пытайтесь ускорять процессы силой. Полезнее выбрать один ясный шаг и ${verb} качества ${chakraLabelGenitive("ru", meta.chakraNumber)} через тело и дыхание, а в сложных разговорах сначала возвращаться к спокойному ритму. Так день станет не прогнозом, а понятным планом действий.`;
    },
    discussButton: "Что делать?",
    readMoreButton: "Подробнее",
    detailParagraphs: (forecast) => {
      const meta = getPlanetChakraMap("ru")[forecast.planetOfTheDay];
      const tone = ru.toneLabels[forecast.todayPlanetState.todayTone];
      return [
        `Сегодня алгоритм выделил тему «${meta.label}»: её важность выше остальных направлений дня.`,
        `Тональность сейчас ${tone}, поэтому рекомендация сформулирована как практическое задание: удерживать состояние, которое поддерживает качества ${chakraLabelGenitive("ru", meta.chakraNumber)}, и не разгонять автоматические реакции.`,
        forecast.isAlternativeChoice && forecast.alternativeReasonText
          ? forecast.alternativeReasonText
          : "Если эта тема повторялась несколько дней подряд, приложение может выбрать вторую по значимости чакру, чтобы усилия не зацикливались.",
        "Окна возможностей ниже показывают моменты, когда телу и вниманию легче перестроиться: восход даёт импульс, кульминация усиливает проявление, точный аспект делает тему особенно заметной.",
      ];
    },
  },
  longExplanationModal: {
    title: "Подробнее",
    subtitle: "Развёрнутое объяснение рекомендации дня.",
    closeButton: "Закрыть",
    mathButton: "Расчёты и формулы",
    mathButtonA11y: "Открыть расчёты и формулы рекомендации дня",
    mathCaption: "Точная математика силы и гармоничности планет, веса аспектов и выбор темы дня.",
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
  devResetDayContent: "Обновить",
  freeTierBanner:
    "Внизу вы видите универсальный прогноз на этот день. Конечно, индивидуальные прогнозы, опирающиеся на вашу дату рождения, гораздо точнее. Перейдите на платный тариф, чтобы их получать.",
  mathModal: {
    title: "Математика дня",
    subtitle: "Формулы силы, гармоничности, транзитов и выбора планеты дня.",
    closeButton: "Назад",
    emptyHint: "Математический блок пока не пришёл с прогнозом. Обновите прогноз дня после деплоя backend-части патча.",
    showChartButton: "Показать натальную и транзитную карту",
    chartUnavailableHint: "Карта доступна только для trial/premium-пользователей с натальным профилем.",
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
    const meta = getPlanetChakraMap("en")[forecast.planetOfTheDay];
    return `Today: ${meta.label}. Gather attention around what matters.`;
  },
  refreshButton: "Refresh",
  refreshAccessibilityLabel: "Refresh daily forecast",
  sourceLabel: (source) => `Source: ${source === "cache" ? "cache" : "new calculation"}`,
  skeletonText: "Preparing the daily forecast and opportunity windows...",
  locationErrorTitle: "Location is required",
  locationErrorMessage:
    "Opportunity windows need your location. Allow location access and try again.",
  locationErrorPermissionMessage:
    "Location access is off. Open app settings, allow location, and come back here.",
  locationErrorTimeoutMessage:
    "We could not determine your location in time. Check GPS or Wi‑Fi and try again.",
  openSettingsButton: "Open settings",
  birthDataTitle: "Birth data is required",
  birthDataMessage: "Enter your birth date, time, and place to build a personal daily forecast.",
  staleContentTitle: "Showing saved forecast",
  staleContentMessage: "Fresh data could not be loaded right now, so the latest saved forecast for today is shown temporarily.",
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
    const meta = getPlanetChakraMap("en")[forecast.planetOfTheDay];
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
    chakraLine: (chakraNumber) => `Chakra ${chakraNumber}`,
    toneLine: (tone, label) => `${tone} tone · ${label}`,
  },
  opportunityWindows: {
    title: "Opportunity windows",
    subtitle: (planet) => `Main theme: ${planet}`,
    graphTrack: (planet) => `Chart: ${planet}`,
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
    reminderModalTitle: "Notify me",
    reminderTextLabel: "Notification text",
    reminderModeExact: "at the exact time",
    reminderModeBefore5: "5 minutes before",
    reminderSave: "Save",
    reminderCancel: "Cancel",
    reminderBodyFiveMinPrefix: "5 minutes before",
    reminderPastTitle: "That moment has passed",
    reminderPastMessage: "We can’t schedule a reminder for a window that is already in the past.",
    reminderNotificationsUnavailableTitle: "Notifications unavailable",
    reminderNotificationsUnavailableMessage:
      "This build was compiled without the notifications native module. After a new dev or release build, bells can schedule system notifications.",
    reminderNeedPermissionTitle: "Notifications needed",
    reminderNeedPermissionMessage: "Please allow notifications so Harmonizer can remind you about this window.",
    helpButtonAccessibilityLabel: "Explain the opportunity window chart",
    helpModalTitle: "How to read this window",
    helpLoading: "Preparing the explanation...",
  },
  recommendation: {
    title: "Daily recommendation",
    meta: (planet, chakraName) => `${planet} · ${chakraName}`,
    fallback: (forecast) => {
      const meta = getPlanetChakraMap("en")[forecast.planetOfTheDay];
      const verb = en.toneRecommendationVerb[forecast.todayPlanetState.todayTone];
      return `Today it may help to ${verb} the qualities of Chakra ${meta.chakraNumber}: bring attention to "${meta.label}" and choose a practice without rushing.`;
    },
    discussButton: "What to do?",
    readMoreButton: "More details",
    detailParagraphs: (forecast) => {
      const meta = getPlanetChakraMap("en")[forecast.planetOfTheDay];
      const tone = en.toneLabels[forecast.todayPlanetState.todayTone];
      return [
        `Today's algorithm highlighted "${meta.label}" as the most important theme of the day.`,
        `The tone is ${tone}, so the recommendation is a practical task: hold a state that supports the qualities of ${chakraLabelGenitive("en", meta.chakraNumber)} and avoid automatic reactions.`,
        forecast.isAlternativeChoice && forecast.alternativeReasonText
          ? forecast.alternativeReasonText
          : "If this theme repeats several days in a row, the app may choose the second-most important chakra so your effort does not get stuck.",
        "The opportunity windows below show moments when body and attention can shift more easily: sunrise brings impulse, culmination amplifies expression, an exact aspect makes the theme especially visible.",
      ];
    },
  },
  longExplanationModal: {
    title: "More details",
    subtitle: "An expanded explanation of today's recommendation.",
    closeButton: "Close",
    mathButton: "Calculations and formulas",
    mathButtonA11y: "Open calculations and formulas for today's recommendation",
    mathCaption: "Exact math of planetary strength and harmony, aspect weights, and theme selection.",
  },
  eventBells: {
    title: "Bells",
    empty: "There are no upcoming timed astro-events today.",
    aspectTitle: "Aspect",
  },
  devResetDayContent: "Refresh",
  freeTierBanner:
    "Below you see a universal forecast for today. Personal forecasts based on your birth date are much more accurate. Upgrade to a paid tier to receive them.",
  mathModal: {
    title: "Day mathematics",
    subtitle: "Formulas for strength, harmony, transits, and choosing the planet of the day.",
    closeButton: "Back",
    emptyHint: "The math block has not arrived with the forecast yet. Refresh the daily forecast after the backend update.",
    showChartButton: "Show natal and transit chart",
    chartUnavailableHint: "The chart is available only for trial/premium users with a natal profile.",
  },
  formatTime: (value) => formatTime(value, "en"),
};

export function getHomeStrings(locale: HomeLocale): HomeStrings {
  const inline: "ru" | "en" = locale === "ru" ? "ru" : "en";
  const base = inline === "en" ? en : ru;
  const merged = mergeTypedLocale("home", base, locale);
  return { ...merged, locale: inline };
}

export function resolveLocationErrorMessage(
  reason: LocationAcquireFailureReason | null,
  strings: HomeStrings,
): string {
  if (reason === "permission_denied") return strings.locationErrorPermissionMessage;
  if (reason === "timeout") return strings.locationErrorTimeoutMessage;
  return strings.locationErrorMessage;
}

export function getForecastRecommendation(forecast: DailyForecast, strings: HomeStrings): string {
  const withText = forecast as ForecastWithRecommendation;
  return withText.recommendationShortText?.trim() || strings.recommendation.fallback(forecast);
}
