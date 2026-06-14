import { getResponseLocale } from "@/modules/i18n/localeStore";
import { getAiGlobalContentUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация для сброса дневного контента.");
  return token;
}

export type DevDayContentResetResult = {
  forecast_date?: string;
  deleted?: {
    scenario_cache?: number;
    user_daily_forecasts?: number;
    global_daily_content?: number;
    open_home_conversations?: number;
  };
};

/**
 * Тестовый сброс: POST /api/ai/global-content с `{ "devReset": true }`, затем на клиенте — refresh и remount ассистента.
 */
export async function postGlobalContentDevReset(signal?: AbortSignal): Promise<DevDayContentResetResult | null> {
  const token = await getAccessToken();
  const res = await fetch(getAiGlobalContentUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ devReset: true, responseLocale: getResponseLocale() }),
    signal,
  });
  const data = (await res.json().catch(() => null)) as { error?: string; dev_reset?: DevDayContentResetResult } | null;
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log("[devReset] result", data?.dev_reset ?? null);
  }
  return data?.dev_reset ?? null;
}
