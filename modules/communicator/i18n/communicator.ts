import type { DialogueUseCase, OrchestratorDecision } from "@/services/communicator-client";

export type CommunicatorLocale = "ru" | "en";

type PhaseId =
  | "welcome_and_hint"
  | "listen_user"
  | "deepen_specific_chakra"
  | "acknowledge_and_close"
  | "contextual_greeting"
  | "collect_state"
  | "deepen_inquiry"
  | "offer_insight"
  | "ask_practice_intent"
  | "suggest_practice"
  | "confirm_and_close";

export interface CommunicatorStrings {
  locale: CommunicatorLocale;
  authRequiredError: string;
  sendErrorTitle: string;
  alertOk: string;
  microphonePermissionError: string;
  transcribingStatus: string;
  thinkingStatus: string;
  respondingStatus: string;
  typingStatus: (phaseLabel?: string) => string;
  phaseLabels: Record<PhaseId, string>;
  fallbackPhaseLabel: (phaseId: string) => string;
  textPlaceholder: string;
  sendButton: string;
  sendAccessibilityLabel: string;
  cancelRequestAccessibilityLabel: string;
  holdToRecordAccessibilityLabel: string;
  scrollDownAccessibilityLabel: string;
  collapseAccessibilityLabel: string;
  expandAccessibilityLabel: string;
  switchToVoiceAccessibilityLabel: string;
  switchToTextAccessibilityLabel: string;
  practiceCard: {
    eyebrow: string;
    fallbackTitle: string;
    startButton: string;
    startAccessibilityLabel: string;
    closedWithoutPractice: string;
  };
  transcribeLanguage: string;
  defaultSystemPrompt: (useCase: DialogueUseCase) => string;
  phaseLabelFor: (decision: OrchestratorDecision | null) => string | undefined;
}

const ruPhaseLabels: CommunicatorStrings["phaseLabels"] = {
  welcome_and_hint: "приветствие",
  listen_user: "слушаю",
  deepen_specific_chakra: "уточнение",
  acknowledge_and_close: "завершение калибровки",
  contextual_greeting: "контекст",
  collect_state: "сбор состояния",
  deepen_inquiry: "углубление",
  offer_insight: "инсайт",
  ask_practice_intent: "выбор практики",
  suggest_practice: "практика",
  confirm_and_close: "завершение",
};

const enPhaseLabels: CommunicatorStrings["phaseLabels"] = {
  welcome_and_hint: "greeting",
  listen_user: "listening",
  deepen_specific_chakra: "clarifying",
  acknowledge_and_close: "calibration close",
  contextual_greeting: "context",
  collect_state: "state check",
  deepen_inquiry: "deeper question",
  offer_insight: "insight",
  ask_practice_intent: "practice intent",
  suggest_practice: "practice",
  confirm_and_close: "closing",
};

function phaseLabelFor(
  decision: OrchestratorDecision | null,
  labels: CommunicatorStrings["phaseLabels"],
  fallback: (phaseId: string) => string,
): string | undefined {
  const phase = decision?.next_phase;
  if (!phase) return undefined;
  return labels[phase as PhaseId] ?? fallback(phase);
}

const ru: CommunicatorStrings = {
  locale: "ru",
  authRequiredError: "Нужна авторизация Supabase для запроса к ассистенту.",
  sendErrorTitle: "Не удалось отправить сообщение",
  alertOk: "OK",
  microphonePermissionError: "Нет доступа к микрофону",
  transcribingStatus: "Расшифровка",
  thinkingStatus: "...",
  respondingStatus: "Отвечаю",
  typingStatus: (phaseLabel) => (phaseLabel ? `Отвечаю · ${phaseLabel}` : "Отвечаю"),
  phaseLabels: ruPhaseLabels,
  fallbackPhaseLabel: (phaseId) => phaseId.replace(/_/g, " "),
  textPlaceholder: "Сообщение...",
  sendButton: "Отпр.",
  sendAccessibilityLabel: "Отправить",
  cancelRequestAccessibilityLabel: "Отменить запрос",
  holdToRecordAccessibilityLabel: "Удерживайте для записи",
  scrollDownAccessibilityLabel: "Прокрутить вниз",
  collapseAccessibilityLabel: "Свернуть",
  expandAccessibilityLabel: "Развернуть",
  switchToVoiceAccessibilityLabel: "Переключить на голос",
  switchToTextAccessibilityLabel: "Переключить на текст",
  practiceCard: {
    eyebrow: "Подходящая практика",
    fallbackTitle: "Практика",
    startButton: "Начать практику",
    startAccessibilityLabel: "Начать практику",
    closedWithoutPractice: "Диалог завершён. Практика не была выбрана.",
  },
  transcribeLanguage: "ru",
  defaultSystemPrompt: () => "Ты эмпатичный наставник приложения Harmonizer. Отвечай кратко и по делу.",
  phaseLabelFor: (decision) => phaseLabelFor(decision, ruPhaseLabels, ru.fallbackPhaseLabel),
};

const en: CommunicatorStrings = {
  locale: "en",
  authRequiredError: "Supabase authorization is required to contact the assistant.",
  sendErrorTitle: "Could not send message",
  alertOk: "OK",
  microphonePermissionError: "Microphone access is not available",
  transcribingStatus: "Transcribing",
  thinkingStatus: "...",
  respondingStatus: "Responding",
  typingStatus: (phaseLabel) => (phaseLabel ? `Responding · ${phaseLabel}` : "Responding"),
  phaseLabels: enPhaseLabels,
  fallbackPhaseLabel: (phaseId) => phaseId.replace(/_/g, " "),
  textPlaceholder: "Message...",
  sendButton: "Send",
  sendAccessibilityLabel: "Send",
  cancelRequestAccessibilityLabel: "Cancel request",
  holdToRecordAccessibilityLabel: "Hold to record",
  scrollDownAccessibilityLabel: "Scroll down",
  collapseAccessibilityLabel: "Collapse",
  expandAccessibilityLabel: "Expand",
  switchToVoiceAccessibilityLabel: "Switch to voice",
  switchToTextAccessibilityLabel: "Switch to text",
  practiceCard: {
    eyebrow: "Suggested practice",
    fallbackTitle: "Practice",
    startButton: "Start practice",
    startAccessibilityLabel: "Start practice",
    closedWithoutPractice: "The dialog is complete. No practice was selected.",
  },
  transcribeLanguage: "en",
  defaultSystemPrompt: () => "You are an empathetic Harmonizer mentor. Reply briefly and practically.",
  phaseLabelFor: (decision) => phaseLabelFor(decision, enPhaseLabels, en.fallbackPhaseLabel),
};

export function getCommunicatorStrings(locale: CommunicatorLocale): CommunicatorStrings {
  return locale === "en" ? en : ru;
}
