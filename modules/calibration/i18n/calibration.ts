import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";

export type CalibrationLocale = AppContentLocale;
export type CalibrationPhase =
  | "idle"
  | "recording"
  | "transcribing"
  | "editing"
  | "extracting"
  | "complete"
  | "error";

export type CalibrationStrings = {
  kicker: string;
  title: string;
  description: string;
  phaseLabel: Record<CalibrationPhase, string>;
  lowConfidenceHint: (percent: number) => string;
  extractingHint: string;
  defaultHint: string;
  inputPlaceholder: string;
  addTextTitle: string;
  addTextMessage: string;
  summarySaved: (version?: number | null, ultraUntil?: string | null) => string;
  microphoneDenied: string;
  transcribeFallbackPrefix: string;
  genericFailureTitle: string;
  recordButton: string;
  stopRecordingButton: string;
  runButton: string;
  runningButton: string;
  backButton: string;
};

const ru: CalibrationStrings = {
  kicker: "Calibration",
  title: "Уточнение фундамента",
  description:
    "Расскажите голосом или текстом, что в портрете попало точно, что не откликается и что важно добавить.",
  phaseLabel: {
    idle: "Готов к калибровке",
    recording: "Слушаю обратную связь",
    transcribing: "Расшифровываю голос",
    editing: "Проверь текст перед калибровкой",
    extracting: "Уточняю фундамент",
    complete: "Фундамент уточнён",
    error: "Нужна повторная попытка",
  },
  lowConfidenceHint: (percent) =>
    `Я не уверен, что точно услышал (${percent}%). Проверь и поправь текст перед калибровкой.`,
  extractingHint: "Сверяю ваши слова с картой состояний и пересчитываю силу планет.",
  defaultHint: "Это не редактирование текста, а настройка основы, из которой строится рекомендация.",
  inputPlaceholder:
    "Например: про голос и самовыражение очень точно, а про тревожность я бы усилил...",
  addTextTitle: "Добавьте текст",
  addTextMessage: "Нужен текст обратной связи, чтобы пересобрать калибровку.",
  summarySaved: (version, ultraUntil) =>
    `Калибровка сохранена${version ? `, версия ${version}` : ""}. ${
      ultraUntil ? `Ultra-режим активен до ${ultraUntil}.` : "Ultra-режим активирован на 3 дня."
    }`,
  microphoneDenied: "Нет доступа к микрофону.",
  transcribeFallbackPrefix:
    "Не удалось расшифровать запись автоматически. Можно вставить текст вручную.",
  genericFailureTitle: "Калибровка не завершена",
  recordButton: "Записать голос",
  stopRecordingButton: "Завершить запись",
  runButton: "Уточнить фундамент",
  runningButton: "Уточняем...",
  backButton: "Назад",
};

const en: CalibrationStrings = {
  kicker: "Calibration",
  title: "Refine your foundation",
  description:
    "Share by voice or text what feels accurate in your portrait, what does not resonate, and what matters to add.",
  phaseLabel: {
    idle: "Ready for calibration",
    recording: "Listening to your feedback",
    transcribing: "Transcribing your voice",
    editing: "Review the text before calibration",
    extracting: "Refining the foundation",
    complete: "Foundation updated",
    error: "Another attempt is needed",
  },
  lowConfidenceHint: (percent) =>
    `I am not fully sure I heard this correctly (${percent}%). Please review and edit the text before calibration.`,
  extractingHint: "Comparing your words with the state map and recalculating planetary strength.",
  defaultHint: "This is not text editing. It is a refinement of the base used for future guidance.",
  inputPlaceholder:
    "For example: the part about voice and self-expression feels accurate, but I would strengthen the anxiety part...",
  addTextTitle: "Add some text",
  addTextMessage: "Feedback text is required to rebuild calibration.",
  summarySaved: (version, ultraUntil) =>
    `Calibration saved${version ? `, version ${version}` : ""}. ${
      ultraUntil ? `Ultra mode is active until ${ultraUntil}.` : "Ultra mode is active for 3 days."
    }`,
  microphoneDenied: "Microphone access is not available.",
  transcribeFallbackPrefix:
    "Automatic transcription did not complete. You can paste the text manually.",
  genericFailureTitle: "Calibration was not completed",
  recordButton: "Record voice",
  stopRecordingButton: "Finish recording",
  runButton: "Refine foundation",
  runningButton: "Refining...",
  backButton: "Back",
};

export function getCalibrationStrings(locale: CalibrationLocale = "ru"): CalibrationStrings {
  return inlineBaseLocale(locale) === "en" ? en : ru;
}
