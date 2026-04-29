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
  meta?: Record<string, unknown> & {
    practicePicked?: {
      id: string;
      name?: string;
      reason?: string;
    };
  };
}

/** Задел под Hume: фрагмент записи для анализа эмоций (см. docs/hume_integration.md). */
export interface EmotionSegmentPayload {
  mimeType: string;
  base64: string;
  durationMs: number;
  messageIndex?: number;
}

export type CommunicatorSessionPhase =
  | "idle"
  | "recording"
  | "thinking"
  | "typing"
  | "processing"
  | "streaming"
  | "error"
  | "aborted";

export interface CommunicatorSessionState {
  phase: CommunicatorSessionPhase;
  uiMode: "VOICE" | "TXT";
  canSwitchMode: boolean;
}
