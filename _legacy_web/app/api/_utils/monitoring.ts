import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

type RouteErrorContext = {
  db?: SupabaseClient | null;
  endpoint: string;
  stage?: string;
  userId?: string | null;
  payload?: Record<string, unknown>;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function isTimeoutError(error: unknown): boolean {
  const message = errorMessage(error);
  return /timeout|timed out|abort|deadline/i.test(message);
}

export function isLlmError(error: unknown): boolean {
  const message = errorMessage(error);
  return /gemini|generat|llm|model|GEMINI_API_KEY|Resource exhausted|overloaded|quota|429|503/i.test(message);
}

/** User-facing overload copy from gemini.ts after fallback chain is exhausted. */
export function isExpectedLlmUnavailableError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /Сервис временно недоступен/i.test(message) ||
    /Service is temporarily busy/i.test(message)
  );
}

/** Next.js/Vercel artifact when an SSE ReadableStream errors mid-flight. */
export function isStreamPipeArtifactError(error: unknown): boolean {
  return /failed to pipe response/i.test(errorMessage(error));
}

export function toUserFacingStreamErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (isExpectedLlmUnavailableError(error)) return message;
  if (isTimeoutError(error)) {
    return "Ответ занимает слишком много времени. Попробуйте ещё раз.";
  }
  return "Не удалось выполнить запрос. Попробуйте ещё раз чуть позже.";
}

export async function logUserEvent(
  db: SupabaseClient | null | undefined,
  userId: string | null | undefined,
  kind: string,
  payload: Record<string, unknown>,
) {
  if (!db || !userId) return;
  const { error } = await db.from("user_event_log").insert({
    user_id: userId,
    kind,
    payload,
  });
  if (error) console.warn(`[monitoring] Failed to log ${kind}`, error);
}

/** Успешный ход диалога — сырьё для latency/turns на админ-дашборде. */
export async function logDialogTurn(
  db: SupabaseClient | null | undefined,
  userId: string | null | undefined,
  payload: Record<string, unknown>,
) {
  await logUserEvent(db, userId, "dialog_turn", payload);
}

/** Оценка размера промпта (DTO chars/3.5). Предпочтительно передавать total_tokens. */
export async function logLlmPromptSize(
  db: SupabaseClient | null | undefined,
  userId: string | null | undefined,
  payload: Record<string, unknown>,
) {
  await logUserEvent(db, userId, "llm_prompt_size", payload);
}

export async function reportRouteError(error: unknown, context: RouteErrorContext) {
  const message = errorMessage(error);
  const timeout = isTimeoutError(error);
  const llm = isLlmError(error);
  const expectedUnavailable = isExpectedLlmUnavailableError(error);
  const status = error instanceof Response ? error.status : undefined;

  Sentry.withScope((scope) => {
    if (context.userId) scope.setUser({ id: context.userId });
    scope.setTag("endpoint", context.endpoint);
    if (context.stage) scope.setTag("stage", context.stage);
    if (status) scope.setTag("http_status", String(status));
    if (timeout) scope.setTag("timeout", "true");
    if (llm) scope.setTag("llm_error", "true");
    if (expectedUnavailable) scope.setTag("expected_llm_unavailable", "true");
    if (context.payload) scope.setContext("payload", context.payload);
    if (expectedUnavailable) {
      scope.setLevel("warning");
      Sentry.captureMessage(message, "warning");
      return;
    }
    Sentry.captureException(error);
  });

  await logUserEvent(context.db, context.userId, "api_error", {
    endpoint: context.endpoint,
    stage: context.stage,
    message,
    status,
    timeout,
    llm,
    ...context.payload,
  });

  if (llm || timeout) {
    await logUserEvent(context.db, context.userId, timeout ? "llm_timeout" : "llm_error", {
      endpoint: context.endpoint,
      stage: context.stage,
      message,
      timeout,
      ...context.payload,
    });
  }
}
