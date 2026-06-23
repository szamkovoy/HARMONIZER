import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";

export type AsanaScreenLocale = AppContentLocale;

export type AsanaScreenStrings = {
  defaultTitle: string;
  closeA11y: string;
  unavailableNote: string;
  practiceNotFound: string;
  loadFailed: string;
  videoReadyTitle: string;
  metaPracticeId: string;
  metaVimeoId: string;
  metaDuration: string;
  metaChakras: string;
  metaRecordedAt: string;
  metaLaunchSource: string;
  valueUnknown: string;
  valueNotSelected: string;
  formatDurationMinutes: (minutes: number) => string;
  completeButton: string;
  completingButton: string;
  completedButton: string;
  backToCatalogButton: string;
};

const ru: AsanaScreenStrings = {
  defaultTitle: "Практика асан",
  closeA11y: "Закрыть практику",
  unavailableNote:
    "Локальный Vimeo-плеер временно отключён: текущий dev-client не содержит native WebView-модуль. Следующий шаг — запуск асан через Remote Play на большом экране.",
  practiceNotFound: "Практика не найдена.",
  loadFailed: "Не удалось загрузить практику.",
  videoReadyTitle: "Видео готово к удалённому запуску",
  metaPracticeId: "practiceId",
  metaVimeoId: "Vimeo ID",
  metaDuration: "Длительность",
  metaChakras: "Чакры",
  metaRecordedAt: "Дата записи",
  metaLaunchSource: "Источник запуска",
  valueUnknown: "уточняется",
  valueNotSelected: "не выбрана",
  formatDurationMinutes: (minutes) => `${minutes} мин`,
  completeButton: "Завершить практику",
  completingButton: "Сохраняем...",
  completedButton: "Практика сохранена",
  backToCatalogButton: "Назад к каталогу",
};

const en: AsanaScreenStrings = {
  defaultTitle: "Asana practice",
  closeA11y: "Close practice",
  unavailableNote:
    "The local Vimeo player is temporarily disabled because the current dev client does not include a native WebView module. The next step is launching asanas through Remote Play on a larger screen.",
  practiceNotFound: "Practice not found.",
  loadFailed: "Could not load the practice.",
  videoReadyTitle: "Video is ready for remote launch",
  metaPracticeId: "Practice ID",
  metaVimeoId: "Vimeo ID",
  metaDuration: "Duration",
  metaChakras: "Chakras",
  metaRecordedAt: "Recorded at",
  metaLaunchSource: "Launch source",
  valueUnknown: "pending",
  valueNotSelected: "not selected",
  formatDurationMinutes: (minutes) => `${minutes} min`,
  completeButton: "Complete practice",
  completingButton: "Saving...",
  completedButton: "Practice saved",
  backToCatalogButton: "Back to catalog",
};

export function getAsanaScreenStrings(locale: AsanaScreenLocale = "ru"): AsanaScreenStrings {
  return inlineBaseLocale(locale) === "en" ? en : ru;
}
