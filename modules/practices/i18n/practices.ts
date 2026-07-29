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
  /** When VisionCamera finger PPG plugin is missing (e.g. Android until native port). */
  sensorCameraUnavailableTitle: string;
  sensorCameraUnavailableBody: string;
  sensorBluetoothOption: string;
  sensorBluetoothOtherOption: string;
  sensorNoneOption: string;
  findWearableButton: string;
  wearablePickerTitle: string;
  wearablePickerHint: string;
  wearablePickerFoundHint: string;
  /** When the listed strap already has a verified live link. */
  wearablePickerConnectedHint: string;
  wearablePickerNotFound: string;
  wearablePickerNotFoundTips: string;
  wearablePickerBluetoothOff: string;
  wearablePickerPermissionDenied: string;
  wearablePickerScanBusy: string;
  wearablePickerRetry: string;
  wearablePickerClose: string;
  wearablePickerSelectButton: string;
  wearablePickerConnectedLabel: string;
  wearablePickerFoundNotConnectedLabel: string;
  wearablePickerDisconnectButton: string;
  wearablePickerSignalLabel: string;
  wearableBluetoothStateLabel: string;
  /** Android: while system connect banners + sustained HR. */
  wearablePickerLinkingHint: string;
  wearablePickerLinkingButton: string;
  wearablePickerLinkingStatusLabel: string;
  withPulseSensor: string;
  withoutPulseSensor: string;
  startPractice: string;
  /** Shown on the start button while GATT is opening for a BLE strap. */
  connectingWearableButton: string;
  /** Android: live HR link failed before practice start. */
  wearableLinkFailedTitle: string;
  wearableLinkFailedBody: string;
  wearableLinkRetry: string;
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
  sensorCameraOption: "пульс с телефона",
  sensorCameraUnavailableTitle: "Пульс с камеры недоступен",
  sensorCameraUnavailableBody:
    "На этом устройстве ещё не подключен модуль считывания пульса с камеры. Выберите «без пульсометра» или Bluetooth-пульсометр — либо дождитесь обновления приложения с поддержкой камеры на Android.",
  sensorBluetoothOption: "пульсометр Bluetooth",
  sensorBluetoothOtherOption: "другой Bluetooth-пульсометр",
  sensorNoneOption: "без пульсометра",
  findWearableButton: "Найти пульсометр",
  wearablePickerTitle: "Поиск пульсометра",
  wearablePickerHint: "Ищем совместимый Bluetooth-пульсометр рядом с вами...",
  wearablePickerFoundHint:
    "Пульсометр найден, но ещё не подключён. Нажмите «Подключить» и подтвердите запросы Android сверху (иногда два раза подряд).",
  wearablePickerConnectedHint:
    "Пульсометр найден и подключён. Теперь вы можете закрыть это окно и начать дыхательную практику.",
  wearablePickerNotFound: "Пульсометр не найден. Попробуйте повторить поиск.",
  wearablePickerNotFoundTips:
    "При использовании нагрудного пульсометра: смочите контакты, прижмите его к коже и подождите 5–10 секунд, убедитесь что Bluetooth включен, закройте другие приложения, использующие этот пульсометр. Если датчик ещё не сопряжён с телефоном, откройте приложение производителя и дождитесь сопряжения. При необходимости перезагрузите телефон.",
  wearablePickerBluetoothOff: "Bluetooth выключен. Включите его и повторите поиск.",
  wearablePickerPermissionDenied:
    "Нет разрешения на Bluetooth. Разрешите доступ к Bluetooth в настройках телефона и повторите поиск.",
  wearablePickerScanBusy: "Bluetooth занят предыдущим поиском. Закройте окно и нажмите «Найти пульсометр» ещё раз.",
  wearablePickerRetry: "Повторить поиск",
  wearablePickerClose: "Закрыть",
  wearablePickerSelectButton: "Подключить",
  wearablePickerConnectedLabel: "Подключен · пульс идёт",
  wearablePickerFoundNotConnectedLabel: "Найден · не подключён",
  wearablePickerDisconnectButton: "Отключить",
  wearablePickerSignalLabel: "Сигнал",
  wearableBluetoothStateLabel: "Bluetooth",
  wearablePickerLinkingHint:
    "Подтвердите запросы Android сверху экрана (может появиться дважды). Не закрывайте окно, пока статус не станет «Подключен · пульс идёт».",
  wearablePickerLinkingButton: "Подключаем…",
  wearablePickerLinkingStatusLabel: "Подключение… подтвердите Android сверху",
  withPulseSensor: "с пульсометром",
  withoutPulseSensor: "без пульсометра",
  startPractice: "Начать практику",
  connectingWearableButton: "Подключаем…",
  wearableLinkFailedTitle: "Пульсометр не подключился",
  wearableLinkFailedBody:
    "Нагрудный пульсометр сейчас недоступен. Наденьте ремень, включите Bluetooth, закройте другие приложения с этим датчиком. На Android подтвердите системный запрос сверху, затем нажмите «Повторить». Или выберите «без пульсометра» / «пульс с телефона».",
  wearableLinkRetry: "Повторить",
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
  sensorCameraOption: "pulse from phone",
  sensorCameraUnavailableTitle: "Camera pulse unavailable",
  sensorCameraUnavailableBody:
    "Camera pulse sensing is not available in this build yet. Choose “without heart-rate monitor” or a Bluetooth strap — or update the app when Android camera pulse support ships.",
  sensorBluetoothOption: "Bluetooth heart-rate monitor",
  sensorBluetoothOtherOption: "another Bluetooth heart-rate monitor",
  sensorNoneOption: "without heart-rate monitor",
  findWearableButton: "Find heart-rate monitor",
  wearablePickerTitle: "Find heart-rate monitor",
  wearablePickerHint: "Scanning for a compatible Bluetooth heart-rate monitor nearby...",
  wearablePickerFoundHint:
    "Heart-rate monitor found, but not linked yet. Tap Connect and confirm the Android prompts at the top (sometimes twice).",
  wearablePickerConnectedHint:
    "Heart-rate monitor found and connected. You can close this window and start the breathing practice.",
  wearablePickerNotFound: "Heart-rate monitor not found. Try scanning again.",
  wearablePickerNotFoundTips:
    "For a chest strap heart-rate monitor: moisten the contacts, press it against your skin and wait 5–10 seconds, make sure Bluetooth is on, and close other apps using this monitor. If the sensor is not yet paired with the phone, open the manufacturer's app and wait until it is paired. Restart the phone if needed.",
  wearablePickerBluetoothOff: "Bluetooth is off. Turn it on and try again.",
  wearablePickerPermissionDenied:
    "Bluetooth permission is required. Allow Bluetooth access in phone settings and scan again.",
  wearablePickerScanBusy: "Bluetooth is busy from a previous scan. Close this dialog and tap “Find heart-rate monitor” again.",
  wearablePickerRetry: "Scan again",
  wearablePickerClose: "Close",
  wearablePickerSelectButton: "Connect",
  wearablePickerConnectedLabel: "Connected · pulse live",
  wearablePickerFoundNotConnectedLabel: "Found · not connected",
  wearablePickerDisconnectButton: "Disconnect",
  wearablePickerSignalLabel: "Signal",
  wearableBluetoothStateLabel: "Bluetooth",
  wearablePickerLinkingHint:
    "Confirm the Android prompts at the top (they may appear twice). Keep this window open until the status says “Connected · pulse live”.",
  wearablePickerLinkingButton: "Connecting…",
  wearablePickerLinkingStatusLabel: "Connecting… confirm Android at the top",
  withPulseSensor: "with heart-rate sensor",
  withoutPulseSensor: "without heart-rate sensor",
  startPractice: "Start practice",
  connectingWearableButton: "Connecting…",
  wearableLinkFailedTitle: "Heart-rate monitor did not connect",
  wearableLinkFailedBody:
    "The chest strap is not available right now. Put the strap on, turn Bluetooth on, and close other apps using this sensor. On Android, accept the system prompt at the top, then tap Retry. Or choose “no pulse sensor” / “pulse from phone”.",
  wearableLinkRetry: "Retry",
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
