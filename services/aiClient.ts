import { getAiMonologueUrl } from "@/services/communicatorConfig";
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
): Promise<MonologueResponse<T>> {
  return withTransientNetworkRetry(
    async () => {
      const token = await getAccessToken();
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
            variables,
          }),
          signal,
        });
      } catch (error) {
        throw wrapConnectivityFailure(error, "ai-monologue");
      }
      if (!res.ok) throw await readError(res);
      return (await res.json()) as MonologueResponse<T>;
    },
    { signal },
  );
}
