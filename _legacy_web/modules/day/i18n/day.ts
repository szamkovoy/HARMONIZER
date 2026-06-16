import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale, intlLocaleTag } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type DayLocale = AppContentLocale;

export interface DayStrings {
  locale: DayLocale;
  screenTitle: string;
  yesterdayPrefix: string;
  actionsTitle: string;
  lifeSpheresTitle: string;
  yogaTitle: string;
  meditationLabel: string;
  breathLabel: string;
  asanasLabel: string;
  backLabel: string;
  minutesBucket: (bucket: string) => string;
  noActionsHint: string;
  emptyYogaHint: string;
  addButton: string;
  whatToDoButton: string;
  summarizeButton: string;
  summarizeDayButton: string;
  choosePracticeButton: string;
  cancelPracticeButton: string;
  startPracticeButton: string;
  overdueSummaryHint: string;
  refreshingHint: string;
  retryButton: string;
  loadDayError: string;
  loadPracticesError: string;
  assistantTitle: string;
  closeButton: string;
  assistantSystemPrompt: string;
  deleteActionTitle: string;
  deleteActionMessage: string;
  cancelButton: string;
  deleteButton: string;
  saveButton: string;
  hideRecommendationA11y: string;
  showRecommendationA11y: string;
  editActionA11y: string;
  deleteActionA11y: string;
  actionRecommendationFallback: string;
  formatDateHeader: (localDate: string, kind: "today" | "yesterday" | "other") => string;
  formatTime: (value: string) => string;
  formatDurationMinutes: (minutes: number) => string;
}

function parseLocalDate(localDate: string): Date {
  const [year, month, day] = localDate.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0);
}

function formatDateHeader(localDate: string, kind: "today" | "yesterday" | "other", locale: string): string {
  const formatted = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(parseLocalDate(localDate));
  if (kind === "yesterday") {
    return locale.startsWith("en") ? `Yesterday, ${formatted}` : `Вчера, ${formatted}`;
  }
  return formatted;
}

const ru: DayStrings = {
  locale: "ru",
  screenTitle: "День",
  yesterdayPrefix: "Вчера",
  actionsTitle: "Действия",
  lifeSpheresTitle: "Сферы жизни",
  yogaTitle: "Йога",
  meditationLabel: "Медитация",
  breathLabel: "Дыхание",
  asanasLabel: "Асаны",
  backLabel: "‹ Назад",
  minutesBucket: (bucket) => `${bucket} минут`,
  noActionsHint: "Пока действий нет. Начните с ассистента, и он поможет собрать день.",
  emptyYogaHint: "Выполните практику йоги, чтобы поддержать в себе способность гармонично проявлять рекомендованные состояния.",
  addButton: "Добавить действие",
  whatToDoButton: "Что делать?",
  summarizeButton: "Подытожить",
  summarizeDayButton: "Подытожить этот день",
  choosePracticeButton: "Выбрать практику",
  cancelPracticeButton: "Отменить практику",
  startPracticeButton: "Начать практику",
  overdueSummaryHint: "Для анализа данных, подытожьте действия, которые вы планировали ранее.",
  refreshingHint: "Обновляем день...",
  retryButton: "Повторить",
  loadDayError: "Не удалось загрузить день.",
  loadPracticesError: "Не удалось загрузить практики.",
  assistantTitle: "Ассистент дня",
  closeButton: "Закрыть",
  assistantSystemPrompt:
    "Ты эмпатичный наставник приложения Harmonizer. Помоги пользователю заполнить или подытожить вкладку «День».",
  deleteActionTitle: "Удалить действие?",
  deleteActionMessage: "Рекомендация к этому действию тоже исчезнет из дня.",
  cancelButton: "Отмена",
  deleteButton: "Удалить",
  saveButton: "Сохранить",
  hideRecommendationA11y: "Скрыть рекомендацию",
  showRecommendationA11y: "Показать рекомендацию",
  editActionA11y: "Редактировать действие",
  deleteActionA11y: "Удалить действие",
  actionRecommendationFallback: "Рекомендация появится после обновления ассистента для этого действия.",
  formatDateHeader: (localDate, kind) => formatDateHeader(localDate, kind, "ru"),
  formatTime: (value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(date);
  },
  formatDurationMinutes: (minutes) => `${minutes} мин`,
};

const en: DayStrings = {
  locale: "en",
  screenTitle: "Day",
  yesterdayPrefix: "Yesterday",
  actionsTitle: "Actions",
  lifeSpheresTitle: "Life spheres",
  yogaTitle: "Yoga",
  meditationLabel: "Meditation",
  breathLabel: "Breathing",
  asanasLabel: "Asanas",
  backLabel: "‹ Back",
  minutesBucket: (bucket) => `${bucket} min`,
  noActionsHint: "No actions yet. Start with the assistant — it will help you shape your day.",
  emptyYogaHint: "Do a yoga practice to support the states recommended for today.",
  addButton: "Add action",
  whatToDoButton: "What should I do?",
  summarizeButton: "Summarize",
  summarizeDayButton: "Summarize this day",
  choosePracticeButton: "Choose a practice",
  cancelPracticeButton: "Cancel practice",
  startPracticeButton: "Start practice",
  overdueSummaryHint: "To analyse your data, summarize the actions you planned earlier.",
  refreshingHint: "Refreshing your day...",
  retryButton: "Try again",
  loadDayError: "Could not load the day.",
  loadPracticesError: "Could not load practices.",
  assistantTitle: "Day assistant",
  closeButton: "Close",
  assistantSystemPrompt:
    "You are an empathetic Harmonizer mentor. Help the user fill in or summarize their Day tab.",
  deleteActionTitle: "Delete this action?",
  deleteActionMessage: "The recommendation tied to this action will also disappear from the day.",
  cancelButton: "Cancel",
  deleteButton: "Delete",
  saveButton: "Save",
  hideRecommendationA11y: "Hide recommendation",
  showRecommendationA11y: "Show recommendation",
  editActionA11y: "Edit action",
  deleteActionA11y: "Delete action",
  actionRecommendationFallback: "A recommendation will appear after the assistant updates this action.",
  formatDateHeader: (localDate, kind) => formatDateHeader(localDate, kind, "en"),
  formatTime: (value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(date);
  },
  formatDurationMinutes: (minutes) => `${minutes} min`,
};

export function getDayStrings(locale: DayLocale = "ru"): DayStrings {
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  const merged = mergeTypedLocale("day", base, locale) as DayStrings;
  const intlTag = intlLocaleTag(locale);
  return {
    ...merged,
    locale,
    formatDateHeader: (localDate, kind) => {
      const formatted = new Intl.DateTimeFormat(intlTag, { day: "numeric", month: "long" }).format(
        parseLocalDate(localDate),
      );
      if (kind === "yesterday") return `${merged.yesterdayPrefix}, ${formatted}`;
      return formatted;
    },
    formatTime: (value) => {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return "";
      return new Intl.DateTimeFormat(intlTag, { hour: "2-digit", minute: "2-digit" }).format(date);
    },
  };
}

export function mapDateLabelKind(kind: string): "today" | "yesterday" | "other" {
  if (kind === "yesterday") return "yesterday";
  if (kind === "today") return "today";
  return "other";
}
