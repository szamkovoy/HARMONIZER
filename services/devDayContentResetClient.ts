import type { AccessMode } from "@/services/globalContentClient";
import { getResponseLocale } from "@/modules/i18n/localeStore";
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

/** LLM regen for global content can exceed default fetch timeouts. */
const DEV_RESET_TIMEOUT_MS = 120_000;

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация для сброса дневного контента.");
  return token;
}

export type DevDayContentResetScope = "global" | "personal" | "both";

export type DevDayContentResetResult = {
  scope?: DevDayContentResetScope;
  forecast_date?: string;
  deleted?: {
    scenario_cache?: number;
    user_daily_forecasts?: number;
    global_daily_content?: number;
    open_home_conversations?: number;
  };
};

export function devResetScopeForAccessMode(accessMode: AccessMode): DevDayContentResetScope {
  return accessMode === "free" ? "global" : "personal";
}

/**
 * Test «Обновить»: invalidates cron/server cache for the active tariff path, then caller runs `refresh({ forceRefresh: true })`.
 */
export async function postDevDayContentReset(
  scope: DevDayContentResetScope,
  signal?: AbortSignal,
): Promise<DevDayContentResetResult | null> {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEV_RESET_TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/ai/dev-day-reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ resetScope: scope, responseLocale: getResponseLocale() }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      dev_reset?: DevDayContentResetResult;
    } | null;
    if (!res.ok) {
      throw new Error(data?.error ?? `HTTP ${res.status}`);
    }
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log("[devReset] result", data?.dev_reset ?? null);
    }
    return data?.dev_reset ?? null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** @deprecated Prefer `postDevDayContentReset(scope)` — kept for legacy callers. */
export async function postGlobalContentDevReset(signal?: AbortSignal): Promise<DevDayContentResetResult | null> {
  return postDevDayContentReset("global", signal);
}
