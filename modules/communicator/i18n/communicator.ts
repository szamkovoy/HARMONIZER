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
  | "confirm_and_close"
  | "opening"
  | "inquiry"
  | "forced_final"
  | "fast_track_final"
  | "post_recommendation"
  | "final_recommendation"
  | "final_recommendation_with_validation_warning";

export interface CommunicatorStrings {
  locale: CommunicatorLocale;
  authRequiredError: string;
  sendErrorTitle: string;
  alertOk: string;
  recorderPrepareErrorMessage: string;
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
  transcriptionReviewTitle: string;
  transcriptionReviewHint: (confidence?: number) => string;
  transcriptionReviewCancel: string;
  transcriptionReviewSend: string;
  /** Когда сервер/стрим не вернули видимый текст ответа — вместо пустого пузыря */
  emptyAssistantReplyFallback: string;
  /** Более мягкий локальный fallback после уже показанной карточки практики */
  postPracticeReplyFallback: string;
  /** В пузыре пользователя на время расшифровки голоса (до текста) */
  voiceUserBubblePending: string;
  voiceTranscribeFailedBubble: string;
  practiceCard: {
    eyebrow: string;
    fallbackTitle: string;
    startButton: string;
    startAccessibilityLabel: string;
    closedWithoutPractice: string;
    detailsButton: string;
    detailsTitle: string;
    closeDetailsButton: string;
    instructionVideoLabel: string;
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
  opening: "первый отклик",
  inquiry: "уточнение",
  forced_final: "финальная рекомендация",
  fast_track_final: "практика сразу",
  post_recommendation: "после рекомендации",
  final_recommendation: "финальная рекомендация",
  final_recommendation_with_validation_warning: "финальная рекомендация",
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
  opening: "opening",
  inquiry: "clarifying",
  forced_final: "final recommendation",
  fast_track_final: "direct practice",
  post_recommendation: "after recommendation",
  final_recommendation: "final recommendation",
  final_recommendation_with_validation_warning: "final recommendation",
};

function phaseLabelFor(
  decision: OrchestratorDecision | null,
  labels: CommunicatorStrings["phaseLabels"],
  fallback: (phaseId: string) => string,
): string | undefined {
  const phase = decision?.mode ?? decision?.next_phase;
  if (!phase) return undefined;
  return labels[phase as PhaseId] ?? fallback(phase);
}

const ru: CommunicatorStrings = {
  locale: "ru",
  authRequiredError: "Нужна авторизация Supabase для запроса к ассистенту.",
  sendErrorTitle: "Не удалось отправить сообщение",
  alertOk: "OK",
  recorderPrepareErrorMessage: "Не удалось включить запись. Попробуйте ещё раз.",
  microphonePermissionError: "Нет доступа к микрофону",
  transcribingStatus: "Расшифровка",
  thinkingStatus: "Думаю",
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
  transcriptionReviewTitle: "Проверь распознавание",
  transcriptionReviewHint: (confidence) =>
    confidence == null
      ? "Я не получил оценку качества расшифровки. Проверь текст перед отправкой."
      : `Я не уверен, что точно тебя услышал (${Math.round(confidence * 100)}%). Поправь текст, если нужно.`,
  transcriptionReviewCancel: "Отменить",
  transcriptionReviewSend: "Отправить",
  emptyAssistantReplyFallback:
    "Я не получил полный текст ответа — связь могла прерваться. Напиши ещё раз коротко, что сейчас важно, и я продолжу.",
  postPracticeReplyFallback:
    "Практика уже выбрана. Пусть она пойдёт вам на пользу; если потом захочется вернуться к разговору, я подхвачу.",
  voiceUserBubblePending: "Расшифровываю голос…",
  voiceTranscribeFailedBubble: "Голосовое сообщение не удалось распознать.",
  practiceCard: {
    eyebrow: "Практика на сейчас",
    fallbackTitle: "Практика",
    startButton: "Начать практику",
    startAccessibilityLabel: "Начать практику",
    closedWithoutPractice: "Диалог завершён. Практика не была выбрана.",
    detailsButton: "Описание",
    detailsTitle: "О практике",
    closeDetailsButton: "Понятно",
    instructionVideoLabel: "есть инструкция",
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
  recorderPrepareErrorMessage: "Could not start recording. Please try again.",
  microphonePermissionError: "Microphone access is not available",
  transcribingStatus: "Transcribing",
  thinkingStatus: "Thinking",
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
  transcriptionReviewTitle: "Check transcription",
  transcriptionReviewHint: (confidence) =>
    confidence == null
      ? "I did not receive a transcription quality score. Please check the text before sending."
      : `I am not fully sure I heard you correctly (${Math.round(confidence * 100)}%). Edit the text if needed.`,
  transcriptionReviewCancel: "Cancel",
  transcriptionReviewSend: "Send",
  emptyAssistantReplyFallback:
    "I did not receive the full reply — the connection may have dropped. Send a short note about what matters now and I will continue.",
  postPracticeReplyFallback:
    "The practice is already chosen. May it serve you well; if you want to return to the conversation later, I will pick it up.",
  voiceUserBubblePending: "Transcribing your voice…",
  voiceTranscribeFailedBubble: "Could not recognize the voice message.",
  practiceCard: {
    eyebrow: "Practice for now",
    fallbackTitle: "Practice",
    startButton: "Start practice",
    startAccessibilityLabel: "Start practice",
    closedWithoutPractice: "The dialog is complete. No practice was selected.",
    detailsButton: "Details",
    detailsTitle: "About this practice",
    closeDetailsButton: "Got it",
    instructionVideoLabel: "instruction available",
  },
  transcribeLanguage: "en",
  defaultSystemPrompt: () => "You are an empathetic Harmonizer mentor. Reply briefly and practically.",
  phaseLabelFor: (decision) => phaseLabelFor(decision, enPhaseLabels, en.fallbackPhaseLabel),
};

export function getCommunicatorStrings(locale: CommunicatorLocale): CommunicatorStrings {
  return locale === "en" ? en : ru;
}
