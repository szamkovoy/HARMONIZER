import { getResponseLocale } from "@/modules/i18n/localeStore";
import { getAiMonologueUrl } from "@/services/communicatorConfig";
import { DAY_CONTENT_LLM_TIMEOUT_MS } from "@/services/dayContentTimeouts";
import { requireSupabase } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";

export type MonologueResponse<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  cached?: boolean;
  scenario_id?: string;
  modelUsed?: string;
  error?: string;
};

export type MathLevelResponse = {
  markdown: string;
  structured: {
    natal_strengths: Array<{ planet: string; chakra: number; S: number; H: number; formula_summary: string }>;
    main_aspects: Array<{ from: string; to: string; type: string; orb: number; coef: number; activation: number }>;
    importance_breakdown: Array<{ planet: string; activation: number; S_eff: number; importance: number }>;
    calibration_deltas?: Array<{ planet: string; dS: number; dH: number }>;
  };
};

export type MorningRecommendationResponse = MonologueResponse<{
  slogan: string;
  short_text: string;
  long_explanation: string;
  math_level: MathLevelResponse;
}>;

/**
 * Верхняя граница ожидания монолога на клиенте — общий бюджет
 * `DAY_CONTENT_LLM_TIMEOUT_MS` (120s): серверная retry/fallback-цепочка
 * `generateGeminiJson` до ~90s + запас. По истечении фоновый слой Home ловит
 * ошибку и показывает детерминированный fallback; сервер может ещё дозаписать cache.
 */
const MONOLOGUE_TIMEOUT_MS = DAY_CONTENT_LLM_TIMEOUT_MS;

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для AI-сценария.");
  return token;
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return new Error(data?.error ?? `HTTP ${res.status}`);
  }
  const text = await res.text().catch(() => res.statusText);
  const looksLikeHtml = text.trimStart().startsWith("<!") || /<html[\s>]/i.test(text);
  if (looksLikeHtml) {
    return new Error(`AI monologue API returned HTML (${res.status}).`);
  }
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

export async function callMonologue<T extends Record<string, unknown> = Record<string, unknown>>(
  scenarioId: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
  responseLocale?: string,
): Promise<MonologueResponse<T>> {
  return withTransientNetworkRetry(
    async () => {
      const token = await getAccessToken();
      const locale = responseLocale ?? getResponseLocale();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MONOLOGUE_TIMEOUT_MS);
      signal?.addEventListener("abort", () => controller.abort(), { once: true });
      let res: Response;
      try {
        res = await fetch(getAiMonologueUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            scenario_id: scenarioId,
            responseLocale: locale,
            variables,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) {
          throw new Error(
            `AI monologue request timed out after ${Math.round(MONOLOGUE_TIMEOUT_MS / 1000)}s.`,
          );
        }
        throw wrapConnectivityFailure(error, "ai-monologue");
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) throw await readError(res);
      return (await res.json()) as MonologueResponse<T>;
    },
    { signal },
  );
}
