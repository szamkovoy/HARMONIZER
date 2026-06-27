import type { BreathPracticeId } from "@/modules/breath";
import type { PracticeKind } from "@/modules/practices/core/types";

import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type PracticeLocale = AppContentLocale;

export interface PracticeCatalogStrings {
  locale: PracticeLocale;
  screenTitle: string;
  screenSubtitle: string;
  loadingCatalog: string;
  partialCatalogTitle: string;
  retryButton: string;
  filterTitle: string;
  allChakras: string;
  anyDuration: string;
  durationShort: string;
  durationMedium: string;
  durationLong: string;
  yogaLateLoading: string;
  yogaLateHint: string;
  catalogFooter: (total: number) => string;
  /** `{total}` placeholder — synced to overlays; wired in `getPracticeCatalogStrings`. */
  catalogFooterTemplate: string;
  emptyPracticesTitle: string;
  emptyPracticesHint: string;
  yogaLateLoadingTitle: string;
  invalidChakraFilterHint: string;
  groupMeditation: string;
  groupBreath: string;
  groupYoga: string;
  yogaTitlePrefix: string;
  practiceCount: (count: number) => string;
  /** Singular label (EN: «1 practice»). */
  practiceCountOne: string;
  /** Plural label with `{count}` (RU/EN/…). */
  practiceCountWithTotal: string;
  emptyGroup: string;
  masterOnly: string;
  remotePlayHint: string;
  connectTv: string;
  changeTv: string;
  videoUnavailableTitle: string;
  videoUnavailableMessage: string;
  remotePlayErrorTitle: string;
  loadCatalogError: string;
  durationSelectable: string;
  durationPending: string;
  /** Short unit after a number, e.g. «10 мин» / «10 min». */
  durationMinUnit: string;
  /** Prefix for selectable duration, e.g. «от» / «from». */
  durationFromPrefix: string;
  chakraPending: string;
  durationLabel: string;
  chakraLabel: string;
  pulseLabel: string;
  sensorCameraOption: string;
  sensorBluetoothOption: string;
  sensorNoneOption: string;
  withPulseSensor: string;
  withoutPulseSensor: string;
  startPractice: string;
  openOnPhone: string;
  openOnTv: string;
  videoLabel: string;
  breathDescriptions: Record<BreathPracticeId, string>;
  meditationFlashTitle: string;
  meditationFlashSubtitle: string;
  meditationFlashDescription: string;
}

const ru: PracticeCatalogStrings = {
  locale: "ru",
  screenTitle: "Каталог практик",
  screenSubtitle: "Выберите, что вас интересует.",
  loadingCatalog: "Собираем каталог...",
  partialCatalogTitle: "Каталог загружен частично",
  retryButton: "Повторить",
  filterTitle: "Фильтр",
  allChakras: "Все чакры",
  anyDuration: "Любая длительность",
  durationShort: "20-30 минут",
  durationMedium: "30-45 минут",
  durationLong: "45-60 минут",
  yogaLateLoading: "загружаем...",
  yogaLateHint: "Supabase отвечает медленнее обычного. Каталог уже открыт, а асаны появятся здесь автоматически.",
  catalogFooter: (total) => `Всего в каталоге: ${total}. Запуск идет через существующие экраны практик.`,
  catalogFooterTemplate:
    "Всего в каталоге: {total}. Запуск идет через существующие экраны практик.",
  emptyPracticesTitle: "Здесь скоро появятся практики",
  emptyPracticesHint: "Попробуйте другой фильтр или проверьте подключение к каталогу.",
  yogaLateLoadingTitle: "Асаны ещё загружаются",
  invalidChakraFilterHint: "Некорректный фильтр чакры будет проигнорирован.",
  groupMeditation: "Медитации",
  groupBreath: "Дыхание",
  groupYoga: "Асаны",
  yogaTitlePrefix: "Практика",
  practiceCount: (count) => `${count} практик`,
  practiceCountOne: "1 практика",
  practiceCountWithTotal: "{count} практик",
  emptyGroup: "пока пусто",
  masterOnly: "только Master",
  remotePlayHint: "Подключите TV, чтобы смотреть видео на большом экране.",
  connectTv: "Подключить ТВ",
  changeTv: "Сменить ТВ",
  videoUnavailableTitle: "Видео недоступно",
  videoUnavailableMessage: "У этой асаны пока нет Vimeo ID для Remote Play.",
  remotePlayErrorTitle: "Remote Play",
  loadCatalogError: "Не удалось загрузить каталог практик.",
  durationSelectable: "длительность выбирается",
  durationPending: "длительность уточняется",
  durationMinUnit: "мин",
  durationFromPrefix: "от",
  chakraPending: "чакра уточняется",
  durationLabel: "Длительность",
  chakraLabel: "Чакра",
  pulseLabel: "Источник пульса",
  sensorCameraOption: "камера телефона",
  sensorBluetoothOption: "пульсометр Bluetooth",
  sensorNoneOption: "без сенсора",
  withPulseSensor: "с пульсометром",
  withoutPulseSensor: "без пульсометра",
  startPractice: "Начать практику",
  openOnPhone: "Открыть на телефоне",
  openOnTv: "Открыть на ТВ",
  videoLabel: "Видео",
  breathDescriptions: {
    coherent:
      "Создаёт глубокий физиологический резонанс между сердцем и мозгом, переводя всю систему в режим максимальной энергоэффективности и эмоциональной неуязвимости.",
    "nadi-shodhana":
      "Выполняет тонкую калибровку полушарий мозга, устраняя функциональную асимметрию и делая вашу психику невероятно пластичной и гармоничной.",
    "surya-bhedana":
      "Ваша «педаль газа» для мгновенной активации мозга, пробуждения внутренней энергии и быстрого выхода из состояния апатии или утренней заторможенности.",
    "chandra-bhedana":
      "Естественный «тормоз» для нервной системы, который напрямую стимулирует парасимпатику, охлаждает эмоции и быстро снимает накопленное за день напряжение.",
    square:
      "Эталонная техника спецназа для сохранения абсолютного хладнокровия и контроля в ситуациях высокого давления, удерживающая вас в коридоре максимальной эффективности.",
    "triangle-up":
      "Мощная физиологическая перезагрузка, которая через задержку на выдохе буквально выключает очаги тревоги и тренирует фундаментальную устойчивость к стрессовым факторам.",
    "triangle-down":
      "Интенсивный клеточный оксигенатор, который за счёт задержки на вдохе «пропитывает» ткани мозга кислородом, возвращая ясность мысли и когнитивную бодрость.",
  },
  meditationFlashTitle: "Вспышка",
  meditationFlashSubtitle: "Поток сакральных символов",
  meditationFlashDescription:
    "Короткая визуальная медитация для мягкого переключения внимания и гармонизации.",
};

const en: PracticeCatalogStrings = {
  ...ru,
  locale: "en",
  screenTitle: "Practice catalog",
  screenSubtitle: "Choose what interests you.",
  loadingCatalog: "Loading the catalog...",
  partialCatalogTitle: "Catalog loaded partially",
  retryButton: "Try again",
  filterTitle: "Filter",
  allChakras: "All chakras",
  anyDuration: "Any duration",
  durationShort: "20–30 minutes",
  durationMedium: "30–45 minutes",
  durationLong: "45–60 minutes",
  yogaLateLoading: "loading...",
  yogaLateHint: "Supabase is slower than usual. The catalog is open — asanas will appear here automatically.",
  catalogFooter: (total) => `${total} practices in the catalog. Launch uses the existing practice screens.`,
  catalogFooterTemplate: "{total} practices in the catalog. Launch uses the existing practice screens.",
  emptyPracticesTitle: "Practices will appear here soon",
  emptyPracticesHint: "Try another filter or check your connection to the catalog.",
  yogaLateLoadingTitle: "Asanas are still loading",
  invalidChakraFilterHint: "An invalid chakra filter will be ignored.",
  groupMeditation: "Meditation",
  groupBreath: "Breathing",
  groupYoga: "Asanas",
  yogaTitlePrefix: "Practice",
  practiceCount: (count) => (count === 1 ? "1 practice" : `${count} practices`),
  practiceCountOne: "1 practice",
  practiceCountWithTotal: "{count} practices",
  emptyGroup: "empty for now",
  masterOnly: "Master only",
  remotePlayHint: "Connect a TV to watch video on the big screen.",
  connectTv: "Connect TV",
  changeTv: "Change TV",
  videoUnavailableTitle: "Video unavailable",
  videoUnavailableMessage: "This asana does not have a Vimeo ID for Remote Play yet.",
  remotePlayErrorTitle: "Remote Play",
  loadCatalogError: "Could not load the practice catalog.",
  durationSelectable: "duration selectable",
  durationPending: "duration pending",
  durationMinUnit: "min",
  durationFromPrefix: "from",
  chakraPending: "chakra pending",
  durationLabel: "Duration",
  chakraLabel: "Chakra",
  pulseLabel: "Pulse source",
  sensorCameraOption: "phone camera",
  sensorBluetoothOption: "Bluetooth sensor",
  sensorNoneOption: "without sensor",
  withPulseSensor: "with heart-rate sensor",
  withoutPulseSensor: "without heart-rate sensor",
  startPractice: "Start practice",
  openOnPhone: "Open on phone",
  openOnTv: "Open on TV",
  videoLabel: "Video",
  breathDescriptions: {
    coherent:
      "Creates deep physiological resonance between heart and brain, shifting the whole system toward energy efficiency and emotional steadiness.",
    "nadi-shodhana":
      "Fine-tunes the brain hemispheres, easing functional asymmetry and making your psyche more flexible and harmonious.",
    "surya-bhedana":
      "Your inner accelerator — quick brain activation, inner energy, and a way out of apathy or morning sluggishness.",
    "chandra-bhedana":
      "A natural brake for the nervous system: stimulates the parasympathetic branch, cools emotions, and releases daily tension.",
    square:
      "A classic technique for calm control under pressure — keeps you in the corridor of peak effectiveness.",
    "triangle-up":
      "A powerful physiological reset: the exhale hold quiets anxiety hotspots and trains stress resilience.",
    "triangle-down":
      "An intense cellular oxygenator: the inhale hold saturates brain tissue with oxygen, restoring clarity and alertness.",
  },
  meditationFlashTitle: "Flash",
  meditationFlashSubtitle: "Flow of sacred symbols",
  meditationFlashDescription: "A short visual meditation for a gentle shift of attention and harmonization.",
};

export function getPracticeCatalogStrings(locale: PracticeLocale = "ru"): PracticeCatalogStrings {
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  const merged = mergeTypedLocale("practices", base, locale) as PracticeCatalogStrings;
  const useEnSingular = inlineBaseLocale(locale) === "en";
  return {
    ...merged,
    locale,
    practiceCount: (count) =>
      useEnSingular && count === 1
        ? merged.practiceCountOne
        : merged.practiceCountWithTotal.replace("{count}", String(count)),
    catalogFooter: (total) => merged.catalogFooterTemplate.replace("{total}", String(total)),
  };
}

export function getPracticeGroupTitle(kind: PracticeKind, strings: PracticeCatalogStrings): string {
  if (kind === "meditation") return strings.groupMeditation;
  if (kind === "breath") return strings.groupBreath;
  return strings.groupYoga;
}
