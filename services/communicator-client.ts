import { getCalibrationExtractUrl, getCommunicatorV2DialogUrl, getCommunicatorV2TranscribeUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

export type DialogueUseCase = "calibration" | "daily_dialog";
export type DialogueEntrySource = "home" | "event_reminder" | "practice_discuss" | "stories" | "onboarding";
export type DialogueDecisionSource = "fresh" | "bypass_greeting" | "cache_reused";

export interface OrchestratorDecision {
  next_phase: string;
  reasoning: string;
  information_completeness: Record<string, number>;
  information_density: number;
  user_signals: string[];
  should_close: boolean;
  close_reason?: "goal_reached" | "soft_cap_hit" | "user_disengaged" | null;
  responder_hints?: {
    tone?: "warm" | "neutral" | "energising" | "calming";
    use_user_phrases?: string[];
    avoid_topics?: string[];
  };
  decision_source?: DialogueDecisionSource;
  cache_similarity?: number;
  bypass_reason?: string;
}

export interface PracticePicked {
  id: string;
  name?: string;
  reason?: string;
}

export interface RecommendationCorrected {
  newShortText?: string;
  short_text?: string;
  windows_correction?: string;
}

export interface DialogCompleteEvent {
  messageId?: string;
  conversationId?: string;
  fullText: string;
  shouldClose: boolean;
  modelUsed?: string;
  practicePicked?: PracticePicked;
  recommendationCorrected?: RecommendationCorrected;
}

export interface SendDialogMessageParams {
  conversationId: string | null;
  useCase: DialogueUseCase;
  entrySource: DialogueEntrySource;
  triggerMeta?: Record<string, unknown>;
  userMessage: string;
  userTimezone: string;
  signal?: AbortSignal;
  onOrchestratorDecision?: (decision: OrchestratorDecision) => void;
  onChunk?: (text: string) => void;
  onComplete?: (event: DialogCompleteEvent) => void;
}

export interface DialogSessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  meta?: Record<string, unknown>;
}

export interface DialogSessionResponse {
  conversationId: string | null;
  messages: DialogSessionMessage[];
  reset: boolean;
}

export interface SendDialogMessageResult {
  decision: OrchestratorDecision | null;
  fullText: string;
  modelUsed?: string;
  complete: DialogCompleteEvent | null;
}

export interface CalibrationExtractRequest {
  source?: "initial" | "manual_resync" | "auto_aggregated";
  feedbackText?: string;
  conversationDigest?: unknown;
  language?: string;
}

export interface CalibrationExtractResponse {
  calibration?: unknown;
  ultraMode?: {
    enabledUntil: string;
    source: "calibration";
  };
  debug?: unknown;
  error?: string;
}

export interface TranscribeAudioRequest {
  mimeType: string;
  base64: string;
  language?: string;
  signal?: AbortSignal;
}

export interface TranscribeAudioResponse {
  text: string;
  language?: string;
  durationSeconds?: number;
  confidence?: number;
}

type SseEvent = {
  event: string;
  data: string;
};

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для запроса к ассистенту.");
  return token;
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return new Error(data?.error ?? `HTTP ${res.status}`);
  }
  const errText = await res.text().catch(() => res.statusText);
  if (errText.includes("DEPLOYMENT_NOT_FOUND")) {
    return new Error(
      `Vercel deployment is not available for EXPO_PUBLIC_COMMUNICATOR_API_URL (${res.status}). Обновите backend origin или запустите локальный _legacy_web API.`,
    );
  }
  const looksLikeHtml = errText.trimStart().startsWith("<!") || /<html[\s>]/i.test(errText);
  if (looksLikeHtml) {
    return new Error(`Сервер вернул HTML вместо API (${res.status}). Проверьте EXPO_PUBLIC_COMMUNICATOR_API_URL.`);
  }
  return new Error(errText.slice(0, 280) || `HTTP ${res.status}`);
}

function parseSseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

function safeJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function networkError(url: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Communicator network error for ${url}: ${message}`);
}

function handleSseEvent(
  event: SseEvent,
  params: SendDialogMessageParams,
  state: SendDialogMessageResult,
) {
  if (event.event === "orchestrator_decision") {
    const decision = safeJson<OrchestratorDecision>(event.data);
    state.decision = decision;
    params.onOrchestratorDecision?.(decision);
    return;
  }
  if (event.event === "chunk") {
    const payload = safeJson<{ text?: string; modelUsed?: string }>(event.data);
    const text = payload.text ?? "";
    state.fullText += text;
    if (payload.modelUsed) state.modelUsed = payload.modelUsed;
    params.onChunk?.(text);
    return;
  }
  if (event.event === "complete") {
    const complete = safeJson<DialogCompleteEvent>(event.data);
    state.complete = complete;
    if (!state.fullText && complete.fullText) state.fullText = complete.fullText;
    if (complete.modelUsed) state.modelUsed = complete.modelUsed;
    params.onComplete?.(complete);
  }
}

async function readSseResponse(res: Response, params: SendDialogMessageParams): Promise<SendDialogMessageResult> {
  const state: SendDialogMessageResult = { decision: null, fullText: "", complete: null };

  if (!res.body) {
    const text = await res.text();
    for (const block of text.split(/\r?\n\r?\n/)) {
      const event = parseSseBlock(block);
      if (event) handleSseEvent(event, params, state);
    }
    return state;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (params.signal?.aborted) {
        await reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseSseBlock(block);
        if (event) handleSseEvent(event, params, state);
      }
    }
    buffer += decoder.decode();
    const lastEvent = parseSseBlock(buffer);
    if (lastEvent) handleSseEvent(lastEvent, params, state);
  } finally {
    reader.releaseLock();
  }

  return state;
}

export async function sendDialogMessage(params: SendDialogMessageParams): Promise<SendDialogMessageResult> {
  const token = await getAccessToken();
  const url = getCommunicatorV2DialogUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId: params.conversationId,
        useCase: params.useCase,
        entrySource: params.entrySource,
        triggerMeta: params.triggerMeta ?? {},
        userMessage: params.userMessage,
        userTimezone: params.userTimezone,
      }),
      signal: params.signal,
    });
  } catch (error) {
    throw networkError(url, error);
  }

  if (!res.ok) throw await readError(res);
  return readSseResponse(res, params);
}

export async function fetchDialogSession(params: {
  useCase: DialogueUseCase;
  entrySource: DialogueEntrySource;
  signal?: AbortSignal;
}): Promise<DialogSessionResponse> {
  const token = await getAccessToken();
  const baseUrl = getCommunicatorV2DialogUrl();
  const url = `${baseUrl}?useCase=${encodeURIComponent(params.useCase)}&entrySource=${encodeURIComponent(params.entrySource)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: params.signal,
    });
  } catch (error) {
    throw networkError(url, error);
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as DialogSessionResponse;
}

export async function transcribeCommunicatorAudio(req: TranscribeAudioRequest): Promise<TranscribeAudioResponse> {
  const token = await getAccessToken();
  const url = getCommunicatorV2TranscribeUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        audio: { mimeType: req.mimeType, base64: req.base64 },
        language: req.language ?? "ru",
      }),
      signal: req.signal,
    });
  } catch (error) {
    throw networkError(url, error);
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as TranscribeAudioResponse;
}

export async function extractCalibration(req: CalibrationExtractRequest, signal?: AbortSignal): Promise<CalibrationExtractResponse> {
  const token = await getAccessToken();
  const url = getCalibrationExtractUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        source: req.source ?? "initial",
        feedbackText: req.feedbackText,
        conversationDigest: req.conversationDigest,
        language: req.language ?? "ru",
      }),
      signal,
    });
  } catch (error) {
    throw networkError(url, error);
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as CalibrationExtractResponse;
}
