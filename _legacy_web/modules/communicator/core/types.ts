/**
 * Публичные типы модуля COMMUNICATOR (контракт интеграции с ASSISTANT и др.).
 */

export type CommunicatorModePolicy = "VOICE" | "TXT" | "VOICE_ONLY" | "TXT_ONLY";

export type CommunicatorInitialMode = "VOICE" | "TXT";

export interface CommunicatorHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  meta?: Record<string, unknown>;
}

/** Задел под Hume: фрагмент записи для анализа эмоций (см. docs/hume_integration.md). */
export interface EmotionSegmentPayload {
  /** Например audio/webm */
  mimeType: string;
  /** Base64 без префикса data: */
  base64: string;
  durationMs: number;
  /** Индекс пользовательского сообщения в текущей сессии (0-based), если применимо */
  messageIndex?: number;
}

export type CommunicatorSessionPhase =
  | "idle"
  | "recording"
  | "processing"
  | "streaming"
  | "error"
  | "aborted";

export interface CommunicatorSessionState {
  phase: CommunicatorSessionPhase;
  uiMode: "VOICE" | "TXT";
  canSwitchMode: boolean;
}
