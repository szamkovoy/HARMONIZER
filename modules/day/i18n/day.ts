import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale, intlLocaleTag } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type DayLocale = AppContentLocale;

export interface DayStrings {
  locale: DayLocale;
  screenTitle: string;
  yesterdayPrefix: string;
  actionsTitle: string;
  actionsHelpButtonAccessibilityLabel: string;
  actionsHelpModalTitle: string;
  actionsHelpBody: string;
  lifeSpheresTitle: string;
  yogaTitle: string;
  yogaHelpButtonAccessibilityLabel: string;
  yogaHelpModalTitle: string;
  yogaHelpBody: string;
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
  actionsTitle: "Психо-практики",
  actionsHelpButtonAccessibilityLabel: "Пояснение к блоку психо-практик",
  actionsHelpModalTitle: "Поведенческие практики",
  actionsHelpBody:
    "Учитесь рассматривать события вашей жизни - как повод для гармонизации, развития, очищения, исцеления, обучения… С этой точки зрения каждое ваше действие является поведенческой практикой. Как вы ходите в тренажерный зал, чтобы дать нагрузку телу и оздоровить его - точно также пространство событий вашей жизни - это тренажеры для вашей психики (и души). Не думайте, что духовность - это отрыв от жизни. Напротив, видьте смыслы ваших действий глубже, чем в плоскости самих действий. Это отличает человека от биоробота.\n\nВ данном окне перечислены события, которые вы планируете на день. Кликнув на событии, вы увидите рекомендации, превращающие привычные вам действия в психопрактику на волне состояний того архетипа, который сегодня наиболее проявлен. В некоторых случаях рекомендации могут казаться вам неудобными или не эффективными. Но, вы ведь понимаете, что в тренажёрном зале не должно быть легко. Следуя рекомендациям вы будете выходить из привычных стереотипов ощущая поддержку планетных ритмов. А в отчетах вы сможете увидеть как постепенно расширяется матрица ваших состояний.",
  lifeSpheresTitle: "Сферы жизни",
  yogaTitle: "Йога-практики",
  yogaHelpButtonAccessibilityLabel: "Пояснение к блоку йога-практик",
  yogaHelpModalTitle: "Зачем нужны практики йоги",
  yogaHelpBody:
    "Порой поведенческие практики могут казаться слишком сложными, и возникает сопротивление - лень, внутренний саботаж, самообман, желание бросить… И тут на помощь приходят практики йоги. В этих практиках мы переходим на язык чакр, потому что для наших задач он проще и информативней, чем язык медицины. Так зачем же усложнять? За один день вы можете освоить язык чакр (мои курсы или интернет вам помогут), и тогда нюансы психосоматики, особенности функционирования гормональной системы, причем именно вашей, и т.п. станут вам очевидны. Вы начнёте тоньше воспринимать свои эмоции, сигналы тела и правильно всё это интерпретировать. И тогда практики йоги наполнятся новым смыслом, логично дополняя ваши поведенческие практики. Таков кратчайший путь к здоровью и к счастью.",
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
  actionsTitle: "Psycho-practices",
  actionsHelpButtonAccessibilityLabel: "Explain the psycho-practices block",
  actionsHelpModalTitle: "Behavioral practices",
  actionsHelpBody:
    "Learn to see the events of your life as occasions for harmonization, growth, cleansing, healing, and learning… From this point of view, every action is a behavioral practice. Just as you go to the gym to load and strengthen the body, the space of your life events is a gym for your psyche (and soul). Do not think of spirituality as a retreat from life. On the contrary, see deeper meaning in your actions than the plane of the actions themselves. That is what sets a human being apart from a bio-robot.\n\nThis panel lists the events you plan for the day. Tap an event to see recommendations that turn familiar actions into a psycho-practice on the wave of the archetype most present today. Sometimes a recommendation may feel inconvenient or ineffective. But you know a gym should not feel easy. Following the recommendations, you step out of habitual stereotypes while feeling the support of planetary rhythms. And in your reports you can watch the matrix of your states gradually widen.",
  lifeSpheresTitle: "Life spheres",
  yogaTitle: "Yoga-practices",
  yogaHelpButtonAccessibilityLabel: "Explain the yoga-practices block",
  yogaHelpModalTitle: "Why yoga practices matter",
  yogaHelpBody:
    "Sometimes behavioral practices can feel too hard, and resistance appears — laziness, inner sabotage, self-deception, the urge to quit… This is where yoga practices help. In these practices we shift to the language of chakras, because for our aims it is simpler and more informative than the language of medicine. So why make it complicated? In a single day you can learn the language of chakras (my courses or the internet will help), and then the nuances of psychosomatics, the specifics of your hormonal system, and so on become clearer. You begin to sense your emotions and body signals more finely and interpret them well. Then yoga practices take on new meaning, naturally complementing your behavioral practices. That is the shortest path to health and happiness.",
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
