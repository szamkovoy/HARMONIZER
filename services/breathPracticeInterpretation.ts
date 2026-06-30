import { getResponseLocale } from "@/modules/i18n/localeStore";
import { getCommunicatorV2PracticeInterpretationUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";

type SubjectiveMoodPayload = {
  id: "better" | "same" | "worse";
  label: string;
};

export type BreathPracticeInterpretationRequest = {
  outcome: Record<string, unknown>;
  subjectiveMood?: SubjectiveMoodPayload | null;
  responseLocale?: string;
};

export type BreathPracticeInterpretationResponse = {
  text: string;
  modelUsed?: string;
};

const INTERPRETATION_REQUEST_TIMEOUT_MS = 120_000;

function linkAbortSignal(parent: AbortSignal | undefined, child: AbortController): void {
  if (parent == null) return;
  if (parent.aborted) {
    child.abort();
    return;
  }
  parent.addEventListener("abort", () => child.abort(), { once: true });
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  linkAbortSignal(externalSignal, controller);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !(externalSignal?.aborted)) {
      throw new Error("Превышено время ожидания интерпретации. Попробуйте ещё раз.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация, чтобы получить интерпретацию.");
  return token;
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return new Error(data?.error ?? `HTTP ${res.status}`);
  }
  const text = await res.text().catch(() => res.statusText);
  if (ct.includes("text/html") || /^\s*<!doctype html/i.test(text)) {
    return new Error(
      "Сервер интерпретации вернул HTML вместо JSON. Обычно это значит, что текущий backend origin не содержит route `/api/communicator/v2/practice-interpretation` и требует deploy.",
    );
  }
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

export async function fetchBreathPracticeInterpretation(
  request: BreathPracticeInterpretationRequest,
  signal?: AbortSignal,
): Promise<BreathPracticeInterpretationResponse> {
  return withTransientNetworkRetry(
    async () => {
      const token = await getAccessToken();
      const responseLocale = request.responseLocale ?? getResponseLocale();
      let res: Response;
      try {
        res = await fetchWithTimeout(
          getCommunicatorV2PracticeInterpretationUrl(),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              outcome: request.outcome,
              subjectiveMood: request.subjectiveMood ?? null,
              responseLocale,
            }),
          },
          INTERPRETATION_REQUEST_TIMEOUT_MS,
          signal,
        );
      } catch (error) {
        throw wrapConnectivityFailure(error, "breath-practice-interpretation");
      }
      if (!res.ok) throw await readError(res);
      const payload = (await res.json()) as BreathPracticeInterpretationResponse;
      if (!payload.text?.trim()) {
        throw new Error("Сервер вернул пустой текст интерпретации.");
      }
      return payload;
    },
    { signal },
  );
}
