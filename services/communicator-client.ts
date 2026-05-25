import { Platform } from "react-native";

import { getAiDialogUrl, getCalibrationExtractUrl, getCommunicatorV2DialogUrl, getCommunicatorV2TranscribeUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";
import type { PracticeRecommendation } from "@/modules/practices";

export type DialogueUseCase = "calibration" | "daily_dialog";
export type DialogueEntrySource = "home" | "event_reminder" | "practice_discuss" | "stories" | "onboarding";

export interface OrchestratorDecision {
  mode?: string;
  modelTier?: "premium" | "standard";
  next_phase?: string;
}

export type PracticePicked = Partial<PracticeRecommendation> & Pick<PracticeRecommendation, "id">;

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
  modelTier?: "premium" | "standard";
  turnMode?: string;
  iteration?: number;
  readyMarkerTriggered?: boolean;
  validation?: {
    confident: boolean;
    hasDuration: boolean;
    hasType: boolean;
  } | null;
  insightMetrics?: {
    csi?: number;
    csi_trend?: number[];
    ttm_stage?: string;
    ttm_confidence?: number;
    etv?: number;
    valence_trend?: number[];
  };
  practicePicked?: PracticePicked;
  branches?: string[];
  phaseTime?: string;
  targetChakra?: { chakraNumber?: number; reason?: string } | null;
  recommendationCorrected?: RecommendationCorrected;
  planningPersistence?: {
    inserted: unknown[];
    summarized: unknown[];
    skipped: unknown[];
  };
  relatedEventIds?: string[];
  skippedPlannedEvents?: unknown[];
  matrixCells?: unknown[];
  debugExport?: Record<string, unknown>;
}

export type DialogTurnHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export interface SendDialogMessageParams {
  scenarioId?: string;
  conversationId: string | null;
  useCase: DialogueUseCase;
  entrySource: DialogueEntrySource;
  triggerMeta?: Record<string, unknown>;
  userMessage: string;
  userTimezone: string;
  /** Client-side transcript for the active session; server does not persist message text in DB. */
  turnHistory?: DialogTurnHistoryItem[];
  initiateDialog?: boolean;
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
  debugExportEnabled?: boolean;
  dialogStateAfter?: Record<string, unknown>;
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

function isMissingSessionSyncEndpoint(error: Error): boolean {
  return /\bHTTP 40[45]\b|Сервер вернул HTML вместо API \(404\)/i.test(error.message);
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

function buildDialogPostBody(params: SendDialogMessageParams): Record<string, unknown> {
  return {
    scenario_id: params.scenarioId,
    conversationId: params.conversationId,
    useCase: params.useCase,
    entrySource: params.entrySource,
    triggerMeta: params.triggerMeta ?? {},
    userMessage: params.initiateDialog ? undefined : params.userMessage,
    userTimezone: params.userTimezone,
    ...(params.turnHistory?.length ? { turnHistory: params.turnHistory } : {}),
    ...(params.initiateDialog ? { initiateDialog: true } : {}),
  };
}

export const DIALOG_TURN_HISTORY_LIMIT = 40;

export function buildClientTurnHistory(
  messages: Array<{ role: string; content: string }>,
  pendingUserText = "",
  voiceUserAlreadyCommitted = false,
): DialogTurnHistoryItem[] {
  const items: DialogTurnHistoryItem[] = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0);
  const trimmedPending = pendingUserText.trim();
  if (trimmedPending && !voiceUserAlreadyCommitted) {
    const last = items[items.length - 1];
    if (!(last?.role === "user" && last.content === trimmedPending)) {
      items.push({ role: "user", content: trimmedPending });
    }
  }
  return items.slice(-DIALOG_TURN_HISTORY_LIMIT);
}

function readErrorFromXhr(xhr: XMLHttpRequest): Error {
  const ct = xhr.getResponseHeader("content-type") ?? "";
  const text = xhr.responseText ?? "";
  if (ct.includes("application/json")) {
    try {
      const data = JSON.parse(text) as { error?: string } | null;
      return new Error(data?.error ?? `HTTP ${xhr.status}`);
    } catch {
      /* fall through */
    }
  }
  if (text.includes("DEPLOYMENT_NOT_FOUND")) {
    return new Error(
      `Vercel deployment is not available for EXPO_PUBLIC_COMMUNICATOR_API_URL (${xhr.status}). Обновите backend origin или запустите локальный _legacy_web API.`,
    );
  }
  const looksLikeHtml = text.trimStart().startsWith("<!") || /<html[\s>]/i.test(text);
  if (looksLikeHtml) {
    return new Error(`Сервер вернул HTML вместо API (${xhr.status}). Проверьте EXPO_PUBLIC_COMMUNICATOR_API_URL.`);
  }
  return new Error(text.slice(0, 280) || `HTTP ${xhr.status}`);
}

/**
 * React Native `fetch` often buffers the whole SSE body until the stream closes.
 * `XMLHttpRequest` exposes `responseText` incrementally on iOS/Android so chunk
 * callbacks fire while the model is still generating.
 */
function readSseResponseWithXHR(
  url: string,
  token: string,
  params: SendDialogMessageParams,
): Promise<SendDialogMessageResult> {
  const state: SendDialogMessageResult = { decision: null, fullText: "", complete: null };

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let carry = "";
    let seen = 0;
    let settled = false;

    const cleanup = () => {
      params.signal?.removeEventListener("abort", onAbort);
    };

    let pollId: ReturnType<typeof setInterval> | null = null;
    const clearPoll = () => {
      if (pollId != null) {
        clearInterval(pollId);
        pollId = null;
      }
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearPoll();
      cleanup();
      fn();
    };

    const drain = () => {
      const rt = xhr.responseText;
      if (rt.length <= seen) return;
      carry += rt.slice(seen);
      seen = rt.length;
      const blocks = carry.split(/\r?\n\r?\n/);
      carry = blocks.pop() ?? "";
      for (const block of blocks) {
        const ev = parseSseBlock(block);
        if (ev) handleSseEvent(ev, params, state);
      }
    };

    const finalizeStream = () => {
      drain();
      const last = parseSseBlock(carry);
      if (last) handleSseEvent(last, params, state);
      carry = "";
    };

    const hasSuccessfulStreamPayload = () =>
      state.complete != null || state.fullText.trim().length > 0;

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
    };
    params.signal?.addEventListener("abort", onAbort);

    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.onprogress = () => {
      if (xhr.status >= 200 && xhr.status < 300) drain();
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.LOADING && xhr.status >= 200 && xhr.status < 300) {
        drain();
      }
    };

    xhr.onload = () => {
      if (params.signal?.aborted) {
        settle(() => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        settle(() => reject(readErrorFromXhr(xhr)));
        return;
      }
      settle(() => {
        finalizeStream();
        resolve(state);
      });
    };

    xhr.onerror = () => {
      settle(() => {
        finalizeStream();
        // iOS/React Native: onerror may fire when the SSE socket closes even after a full body was received.
        if (
          (xhr.status >= 200 && xhr.status < 300 && hasSuccessfulStreamPayload()) ||
          hasSuccessfulStreamPayload()
        ) {
          resolve(state);
          return;
        }
        reject(wrapConnectivityFailure(new Error("Network request failed"), "communicator-dialog"));
      });
    };

    xhr.onabort = () => {
      settle(() => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
    };

    try {
      xhr.send(JSON.stringify(buildDialogPostBody(params)));
      // iOS often omits `onprogress` for long-poll SSE; poll `responseText` growth.
      pollId = setInterval(() => {
        if (settled) return;
        if (xhr.readyState < XMLHttpRequest.LOADING) return;
        if (xhr.status && (xhr.status < 200 || xhr.status >= 300)) return;
        drain();
      }, 24);
    } catch (e) {
      clearPoll();
      settle(() => reject(wrapConnectivityFailure(e, "communicator-dialog")));
    }
  });
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
  return withTransientNetworkRetry(
    async () => {
      const token = await getAccessToken();
      const url = params.scenarioId ? getAiDialogUrl() : getCommunicatorV2DialogUrl();

      if (Platform.OS !== "web") {
        return readSseResponseWithXHR(url, token, params);
      }

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(buildDialogPostBody(params)),
          signal: params.signal,
        });
      } catch (error) {
        throw wrapConnectivityFailure(error, "communicator-dialog");
      }

      if (!res.ok) throw await readError(res);
      return readSseResponse(res, params);
    },
    { signal: params.signal },
  );
}

export async function fetchDialogSession(params: {
  scenarioId?: string;
  useCase: DialogueUseCase;
  entrySource: DialogueEntrySource;
  conversationId?: string;
  debugExport?: boolean;
  signal?: AbortSignal;
}): Promise<DialogSessionResponse> {
  return withTransientNetworkRetry(
    async () => {
      const token = await getAccessToken();
      const baseUrl = params.scenarioId ? getAiDialogUrl() : getCommunicatorV2DialogUrl();
      const query = new URLSearchParams({
        useCase: params.useCase,
        entrySource: params.entrySource,
      });
      if (params.scenarioId) query.set("scenario_id", params.scenarioId);
      if (params.conversationId) query.set("conversationId", params.conversationId);
      if (params.debugExport) query.set("debugExport", "1");
      const url = `${baseUrl}?${query.toString()}`;
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
        throw wrapConnectivityFailure(error, "communicator-session");
      }
      if (!res.ok) {
        const error = await readError(res);
        if (isMissingSessionSyncEndpoint(error)) {
          return { conversationId: null, messages: [], reset: true };
        }
        throw error;
      }
      return (await res.json()) as DialogSessionResponse;
    },
    { signal: params.signal },
  );
}

const TRANSCRIBE_TIMEOUT_MS = 12_000;

export async function transcribeCommunicatorAudio(
  req: TranscribeAudioRequest,
  options?: { useNetworkRetry?: boolean },
): Promise<TranscribeAudioResponse> {
  const runOnce = async () => {
    const token = await getAccessToken();
    const url = getCommunicatorV2TranscribeUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    req.signal?.addEventListener("abort", () => controller.abort(), { once: true });
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
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !req.signal?.aborted) {
        throw new Error(`Transcription timed out after ${Math.round(TRANSCRIBE_TIMEOUT_MS / 1000)}s`);
      }
      throw wrapConnectivityFailure(error, "communicator-transcribe");
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) throw await readError(res);
    return (await res.json()) as TranscribeAudioResponse;
  };

  if (options?.useNetworkRetry === false) {
    return runOnce();
  }

  return withTransientNetworkRetry(runOnce, { signal: req.signal });
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
    throw wrapConnectivityFailure(error, "calibration-extract");
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as CalibrationExtractResponse;
}
