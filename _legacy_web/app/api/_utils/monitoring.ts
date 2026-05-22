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

export async function reportRouteError(error: unknown, context: RouteErrorContext) {
  const message = errorMessage(error);
  const timeout = isTimeoutError(error);
  const llm = isLlmError(error);
  const status = error instanceof Response ? error.status : undefined;

  Sentry.withScope((scope) => {
    if (context.userId) scope.setUser({ id: context.userId });
    scope.setTag("endpoint", context.endpoint);
    if (context.stage) scope.setTag("stage", context.stage);
    if (status) scope.setTag("http_status", String(status));
    if (timeout) scope.setTag("timeout", "true");
    if (llm) scope.setTag("llm_error", "true");
    if (context.payload) scope.setContext("payload", context.payload);
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
