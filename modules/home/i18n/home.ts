import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";
import type { AspectType, DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import { chakraLabelGenitive, type ChakraLocale } from "@/modules/chakra/i18n";
import { getPlanetChakraMap } from "@/modules/home/planetChakra";
import type { LocationAcquireFailureReason } from "@/modules/location/acquireAndPersistUserCoordinates";

export type HomeLocale = AppContentLocale;

/** `{placeholder}` filler for typed home templates (overlays localize the templates). */
export function fillHomeTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name]! : match,
  );
}

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
  enterBirthDataButton: string;
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
    captionFree: string;
    captionPersonal: string;
    helpButtonAccessibilityLabel: string;
    helpModalTitle: string;
    helpBody: string;
  };
  planetBanner: {
    eyebrow: string;
    title: (planet: string) => string;
    chakraLine: (chakraNumber: number, chakraName: string) => string;
    toneLine: (tone: string, label: string) => string;
  };
  opportunityWindows: {
    title: string;
    /** Free: «Главная тема: {planet}». */
    subtitleTemplate: string;
    /**
     * Paid: одна фраза с натальной и транзитной планетами.
     * Шаблоны независимы от склонения/рода названий планет.
     */
    paidIntroTemplate: string;
    emptyDetail: string;
    windowTitles: Record<"sunrise" | "culmination" | "exactAspect", string>;
    aspectLabels: Record<AspectType, string>;
    sunriseDetailTemplate: string;
    culminationDetailTemplate: string;
    /** Paid: «{aspect} {transitPlanet} и {natalPlanet}» — без склонений. */
    exactAspectDetailTemplate: string;
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
    /** Android 12+: без «Будильники и напоминания» DATE-триггер становится inexact. */
    reminderExactAlarmTitle: string;
    reminderExactAlarmMessage: string;
    /** Android 6+: Doze / battery optimization может отложить доставку. */
    reminderBatteryTitle: string;
    reminderBatteryMessage: string;
    /** Xiaomi / Huawei / Oppo / Vivo и др.: автозапуск / фон. */
    reminderOemBackgroundTitle: string;
    reminderOemBackgroundMessage: string;
    helpButtonAccessibilityLabel: string;
    helpModalTitle: string;
    helpLoading: string;
    /** Help-модалка: локализуемые шаблоны с `{placeholders}`. */
    help: {
      freeOpening: string;
      paidOpening: string;
      paidOpeningNoTransit: string;
      sunriseLine: string;
      culminationLine: string;
      exactAspectLine: string;
      closing: string;
      remindersHint: string;
    };
    /** Собраны в `getHomeStrings` из *Template после merge overlays. */
    subtitle: (planet: string) => string;
    paidIntro: (natalPlanet: string, transitPlanet: string) => string;
    sunriseDetail: (planet: string) => string;
    culminationDetail: (planet: string) => string;
    exactAspectDetail: (aspect: string, transitPlanet: string, natalPlanet: string) => string;
  };
  recommendation: {
    title: string;
    /** Shown while locale-specific LLM texts are loading (avoid EN/RU fallback flash). */
    loading: string;
    /** While «Что делать?» checks day plan / opens communicator. */
    discussOpening: string;
    fallback: (forecast: DailyForecast) => string;
    discussButton: string;
    readMoreButton: string;
    detailParagraphs: (forecast: DailyForecast) => string[];
    helpButtonAccessibilityLabel: string;
    helpModalTitle: string;
    helpBody: string;
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
  mathModal: {
    title: string;
    subtitle: string;
    closeButton: string;
    emptyHint: string;
    showChartButton: string;
    showTransitChartButton: string;
    chartUnavailableHint: string;
  };
  astroChartModal: {
    titleTransit: string;
    titleNatal: string;
    titleGlobal: string;
    subtitle: string;
    subtitleGlobal: string;
    housesHiddenHint: string;
    mainAspectsTitle: string;
    planetStrengthsTitle: string;
    planetPositionsTitle: string;
    toNatalConnector: string;
    orbPrefix: string;
    zodiacSigns: Record<string, string>;
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

const ruZodiacSignLabels: Record<string, string> = {
  Aries: "Овен",
  Taurus: "Телец",
  Gemini: "Близнецы",
  Cancer: "Рак",
  Leo: "Лев",
  Virgo: "Дева",
  Libra: "Весы",
  Scorpio: "Скорпион",
  Sagittarius: "Стрелец",
  Capricorn: "Козерог",
  Aquarius: "Водолей",
  Pisces: "Рыбы",
};

const enZodiacSignLabels: Record<string, string> = {
  Aries: "Aries",
  Taurus: "Taurus",
  Gemini: "Gemini",
  Cancer: "Cancer",
  Leo: "Leo",
  Virgo: "Virgo",
  Libra: "Libra",
  Scorpio: "Scorpio",
  Sagittarius: "Sagittarius",
  Capricorn: "Capricorn",
  Aquarius: "Aquarius",
  Pisces: "Pisces",
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
  enterBirthDataButton: "Введите дату рождения",
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
  planetLabels: {
    Sun: "Солнце",
    Moon: "Луна",
    Mercury: "Меркурий",
    Venus: "Венера",
    Mars: "Марс",
    Jupiter: "Юпитер",
    Saturn: "Сатурн",
  },
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
    title: "Навигатор по архетипам",
    captionFree: "Психоархетипическая модель, основанная на планетарной динамике в этот день",
    captionPersonal:
      "Психоархетипическая модель, основанная на планетарной динамике в этот день лично для вас",
    helpButtonAccessibilityLabel: "Пояснение к архетипическому навигатору",
    helpModalTitle: "Как пользоваться навигатором",
    helpBody:
      "Размер семи лепестков данного цветка соответствует астрологической силе планет в этот день. Сегодня это ваш навигатор. Поверьте, что созвездия и астрологию придумали не охотники на мамонтов. Чтобы от бульварных предсказаний перейти к гармонизации своей психики и жизни, воспользуйтесь этой мудростью - рассматривайте каждую планету не как точку в гороскопе, а как архетип. Соединяясь с состояниями архетипов в ритме движения планет, вы будете эффективно распутывать узелки жизненных обстоятельств, которые запутывали многие годы.",
  },
  planetBanner: {
    eyebrow: "Планета дня",
    title: (planet) => planet,
    chakraLine: (_chakraNumber, chakraName) => chakraName,
    toneLine: (tone, label) => `${tone} тон · ${label}`,
  },
  opportunityWindows: {
    title: "Окна возможностей",
    subtitleTemplate: "Главная тема: {planet}",
    paidIntroTemplate:
      "Сегодня проявляйте состояния, которые включает {natalPlanet}. При этом {transitPlanet} будет открывать особые окна возможностей.",
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
    sunriseDetailTemplate: "{planet} поднимается над горизонтом",
    culminationDetailTemplate: "{planet} в максимальной силе",
    exactAspectDetailTemplate: "{aspect} {transitPlanet} (транзит) и {natalPlanet} (натал)",
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
    reminderNeedPermissionMessage:
      "Разрешите уведомления, чтобы {appName} мог напомнить об окне возможностей.",
    reminderExactAlarmTitle: "Нужны точные будильники",
    reminderExactAlarmMessage:
      "На Android напоминания об окнах срабатывают вовремя только если для {appName} включены «Будильники и напоминания». Без этого система может отложить уведомление на час и больше.",
    reminderBatteryTitle: "Отключите оптимизацию батареи",
    reminderBatteryMessage:
      "Чтобы напоминания приходили вовремя, разрешите {appName} работать без ограничений батареи. Иначе Android может отложить уведомление на несколько часов.",
    reminderOemBackgroundTitle: "Разрешите работу в фоне",
    reminderOemBackgroundMessage:
      "На вашем устройстве также включите автозапуск или фоновую работу для {appName} — без этого напоминания могут приходить с опозданием.",
    helpButtonAccessibilityLabel: "Пояснение к графику окон возможностей",
    helpModalTitle: "Как читать это окно",
    helpLoading: "Собираю пояснение...",
    help: {
      freeOpening:
        "Сильнейшая планета дня — {planet}. На графике показано, когда именно {planet} поднимается над горизонтом и достигает зенита в вашем местоположении.",
      paidOpening:
        "Сильнейшей планетой вашей натальной карты сегодня является {natalPlanet}. Эта сила в значительной степени обеспечена взаимодействием с транзитной планетой {transitPlanet}, движение которой по небосклону открывает для вас окна особых возможностей.",
      paidOpeningNoTransit:
        "Сегодня график показывает общее окно возможностей без отдельной явно выраженной транзитной планеты.",
      sunriseLine: "Восход: {time} — {planet} поднимается над горизонтом.",
      culminationLine: "Кульминация: {time} — {planet} в наивысшей точке суточного пути.",
      exactAspectLine: "Точный аспект: {time} — {aspect} {transitPlanet} (транзит) и {natalPlanet} (натал).",
      closing:
        "Это ключевые моменты времени именно в вашей локации. Используйте их для духовных практик, аффирмаций, постановки намерения, медитации и т.п.",
      remindersHint: "Нажмите колокольчик под графиком, чтобы включать напоминания.",
    },
    subtitle: () => "",
    paidIntro: () => "",
    sunriseDetail: () => "",
    culminationDetail: () => "",
    exactAspectDetail: () => "",
  },
  recommendation: {
    title: "Рекомендации на день",
    discussButton: "Что делать?",
    readMoreButton: "Подробнее",
    loading: "Загружаю текст рекомендации на этот день",
    discussOpening: "Открываю ассистента…",
    helpButtonAccessibilityLabel: "Пояснение к рекомендациям на день",
    helpModalTitle: "Основа для рекомендации",
    helpBody:
      "Данная рекомендация описывает самую сильную планету этого дня как архетипический образ согласно аналитической психологии Карла Юнга. Благодаря этому вам станет понятно, на волне каких состояний сегодня целесообразно действовать.\n\nЕсли вас интересует подробный астрологический прогноз, нажмите кнопку «Подробнее». А далее вы сможете ознакомиться с математикой, лежащей в основе этих рекомендаций, и даже посмотреть гороскоп.\n\nИли нажмите кнопку «Что делать?» — чтобы увидеть события, которые предстоят вам в этот день, глазами этого архетипа, и превратить день в набор интересных психопрактик. А через неделю использования этой функции соберётся бистохастическая матрица ваших состояний, и рекомендации станут её точнее.",
    fallback: (forecast) => {
      const meta = getPlanetChakraMap("ru")[forecast.planetOfTheDay];
      const verb = ru.toneRecommendationVerb[forecast.todayPlanetState.todayTone];
      return `Сегодня держите фокус на теме «${meta.label}»: не распыляйтесь, не доказывайте лишнего и не пытайтесь ускорять процессы силой. Полезнее выбрать один ясный шаг и ${verb} качества ${chakraLabelGenitive("ru", meta.chakraNumber)} через тело и дыхание, а в сложных разговорах сначала возвращаться к спокойному ритму. Так день станет не прогнозом, а понятным планом действий.`;
    },
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
    biofeedbackParity: "Biofeedback Parity",
    mandala: "Mandala",
    bindu: "Bindu",
    symbols: "Symbols",
    breath: "Breath",
    calibration: "Calibration",
  },
  devResetDayContent: "Обновить",
  mathModal: {
    title: "Математика дня",
    subtitle: "Формулы силы, гармоничности, транзитов и выбора планеты дня.",
    closeButton: "Закрыть",
    emptyHint: "Математический блок пока не пришёл с прогнозом. Обновите прогноз дня после деплоя backend-части патча.",
    showChartButton: "Показать натальную и транзитную карту",
    showTransitChartButton: "Показать транзитный гороскоп дня",
    chartUnavailableHint: "Карта доступна только для trial/premium-пользователей с натальным профилем.",
  },
  astroChartModal: {
    titleTransit: "Натальная + транзитная карта",
    titleNatal: "Натальная карта",
    titleGlobal: "Транзитный гороскоп дня",
    subtitle: "Внутреннее кольцо — натальные планеты, внешнее — транзиты дня.",
    subtitleGlobal: "Показаны только транзитные планеты дня, знаки зодиака и аспекты между ними.",
    housesHiddenHint: "Дома не показаны: точные кусписы доступны только при точном времени рождения.",
    mainAspectsTitle: "Главные аспекты дня",
    planetStrengthsTitle: "Силы планет",
    planetPositionsTitle: "Положения планет",
    toNatalConnector: "к натальному",
    orbPrefix: ", орб ",
    zodiacSigns: ruZodiacSignLabels,
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
  enterBirthDataButton: "Enter date of birth",
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
  planetLabels: {
    Sun: "Sun",
    Moon: "Moon",
    Mercury: "Mercury",
    Venus: "Venus",
    Mars: "Mars",
    Jupiter: "Jupiter",
    Saturn: "Saturn",
  },
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
    title: "Navigator by archetypes",
    captionFree: "A psycho-archetypal model based on planetary dynamics for this day",
    captionPersonal: "A psycho-archetypal model based on planetary dynamics for this day, tailored to you",
    helpButtonAccessibilityLabel: "Explain the archetypal navigator",
    helpModalTitle: "How to use the navigator",
    helpBody:
      "The size of each of the seven petals reflects the astrological strength of the planets on this day. Today this is your navigator. Trust that constellations and astrology were not invented by mammoth hunters. To move from tabloid predictions toward harmonizing your psyche and life, use this wisdom: see each planet not as a point on a chart, but as an archetype. By connecting with archetypal states in the rhythm of planetary motion, you can effectively untangle life knots that have been tightening for years.",
  },
  planetBanner: {
    eyebrow: "Planet of the Day",
    title: (planet) => planet,
    chakraLine: (chakraNumber) => `Chakra ${chakraNumber}`,
    toneLine: (tone, label) => `${tone} tone · ${label}`,
  },
  opportunityWindows: {
    title: "Opportunity windows",
    subtitleTemplate: "Main theme: {planet}",
    paidIntroTemplate:
      "Today, lean into the states that {natalPlanet} brings online. Meanwhile, {transitPlanet} will open special windows of opportunity.",
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
    sunriseDetailTemplate: "{planet} rises above the horizon",
    culminationDetailTemplate: "{planet} is at peak strength",
    exactAspectDetailTemplate: "{aspect} {transitPlanet} (transit) and {natalPlanet} (natal)",
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
    reminderNeedPermissionMessage:
      "Please allow notifications so {appName} can remind you about this window.",
    reminderExactAlarmTitle: "Exact alarms needed",
    reminderExactAlarmMessage:
      "On Android, opportunity reminders fire on time only if Alarms & reminders are enabled for {appName}. Without that, the system may delay the notification by an hour or more.",
    reminderBatteryTitle: "Turn off battery optimization",
    reminderBatteryMessage:
      "For on-time reminders, allow {appName} to run without battery restrictions. Otherwise Android may delay notifications by several hours.",
    reminderOemBackgroundTitle: "Allow background activity",
    reminderOemBackgroundMessage:
      "On your device, also enable autostart or background activity for {appName}. Without it, reminders may still arrive late.",
    helpButtonAccessibilityLabel: "Explain the opportunity windows chart",
    helpModalTitle: "How to read this window",
    helpLoading: "Preparing the explanation...",
    help: {
      freeOpening:
        "The strongest planet of the day is {planet}. The graph shows when {planet} rises and reaches its zenith at your location.",
      paidOpening:
        "The strongest planet in your natal chart today is {natalPlanet}. This strength largely comes from the interaction with the transiting planet {transitPlanet}, whose path across the sky opens special windows of opportunity for you.",
      paidOpeningNoTransit:
        "Today the graph shows a general opportunity window without a single clearly highlighted transit planet.",
      sunriseLine: "Rise: {time} — {planet} rises above the horizon.",
      culminationLine: "Culmination: {time} — {planet} at the highest point of its daily path.",
      exactAspectLine: "Exact aspect: {time} — {aspect} {transitPlanet} (transit) and {natalPlanet} (natal).",
      closing:
        "These are key moments specifically for your location. Use them for spiritual practices, affirmations, setting intentions, meditation, etc.",
      remindersHint: "Tap the bell below the chart to turn reminders on or off.",
    },
    subtitle: () => "",
    paidIntro: () => "",
    sunriseDetail: () => "",
    culminationDetail: () => "",
    exactAspectDetail: () => "",
  },
  recommendation: {
    title: "Daily recommendation",
    discussButton: "What to do?",
    readMoreButton: "More details",
    loading: "Loading today’s recommendation…",
    discussOpening: "Opening the assistant…",
    helpButtonAccessibilityLabel: "Explain today's recommendation",
    helpModalTitle: "What the recommendation is based on",
    helpBody:
      "This recommendation describes the strongest planet of the day as an archetypal image according to Carl Jung's analytical psychology. It helps you understand which inner states it makes sense to act from today.\n\nIf you want a detailed astrological forecast, tap «More details». Then you can explore the math behind these recommendations and even view the chart.\n\nOr tap «What to do?» to see the events awaiting you today through the eyes of this archetype and turn the day into a set of engaging psycho-practices. After a week of using this feature, a bi-stochastic matrix of your states will be assembled and the recommendations will become more accurate.",
    fallback: (forecast) => {
      const meta = getPlanetChakraMap("en")[forecast.planetOfTheDay];
      const verb = en.toneRecommendationVerb[forecast.todayPlanetState.todayTone];
      return `Today it may help to ${verb} the qualities of Chakra ${meta.chakraNumber}: bring attention to "${meta.label}" and choose a practice without rushing.`;
    },
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
  mathModal: {
    title: "Day mathematics",
    subtitle: "Formulas for strength, harmony, transits, and choosing the planet of the day.",
    closeButton: "Close",
    emptyHint: "The math block has not arrived with the forecast yet. Refresh the daily forecast after the backend update.",
    showChartButton: "Show natal and transit chart",
    showTransitChartButton: "Show today's transit chart",
    chartUnavailableHint: "The chart is available only for trial/premium users with a natal profile.",
  },
  astroChartModal: {
    titleTransit: "Natal + transit chart",
    titleNatal: "Natal chart",
    titleGlobal: "Transit chart of the day",
    subtitle: "Inner ring — natal planets, outer ring — today's transits.",
    subtitleGlobal: "Only today's transiting planets, zodiac signs, and aspects between them are shown.",
    housesHiddenHint: "Houses are hidden: exact cusps require an accurate birth time.",
    mainAspectsTitle: "Main aspects of the day",
    planetStrengthsTitle: "Planetary strength",
    planetPositionsTitle: "Planet positions",
    toNatalConnector: "to natal",
    orbPrefix: ", orb ",
    zodiacSigns: enZodiacSignLabels,
  },
  formatTime: (value) => formatTime(value, "en"),
};

function bindOpportunityWindowHelpers(
  ow: HomeStrings["opportunityWindows"],
): HomeStrings["opportunityWindows"] {
  return {
    ...ow,
    subtitle: (planet) => fillHomeTemplate(ow.subtitleTemplate, { planet }),
    paidIntro: (natalPlanet, transitPlanet) =>
      fillHomeTemplate(ow.paidIntroTemplate, { natalPlanet, transitPlanet }),
    sunriseDetail: (planet) => fillHomeTemplate(ow.sunriseDetailTemplate, { planet }),
    culminationDetail: (planet) => fillHomeTemplate(ow.culminationDetailTemplate, { planet }),
    exactAspectDetail: (aspect, transitPlanet, natalPlanet) =>
      fillHomeTemplate(ow.exactAspectDetailTemplate, { aspect, transitPlanet, natalPlanet }),
  };
}

export function getHomeStrings(locale: HomeLocale): HomeStrings {
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  const merged = mergeTypedLocale("home", base, locale) as HomeStrings;
  return {
    ...merged,
    locale,
    opportunityWindows: bindOpportunityWindowHelpers(merged.opportunityWindows),
    formatTime: (value) => formatTime(value, inlineBaseLocale(locale)),
  };
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
