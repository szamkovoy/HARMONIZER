// @ts-nocheck
/**
 * Shared LLM router for Supabase Edge cron functions.
 *
 * Routes a prompt to either the Gemini API or the DeepSeek (OpenAI-compatible)
 * API depending on the resolved model id, and provides a robust primary →
 * fallback chain. Mirrors the Vercel server's `generateGeminiJson` behaviour
 * (`_legacy_web/app/api/_utils/gemini.ts` + `deepseekOpenAi.ts`) so Edge cron
 * pre-warm works with the SAME `AI_MODEL_*` env values the server uses
 * (incl. `deepseek-*` model ids).
 *
 * Key fix vs. the old per-function copy: a NON-retryable primary failure (e.g.
 * `deepseek-v4-pro` sent to the Gemini API → 404, or missing
 * `DEEPSEEK_API_KEY`) now FALLS BACK to `AI_MODEL_FALLBACK` instead of throwing
 * immediately and writing no row.
 */
import { resolveFallbackGeminiModelIdFromEnv, resolveGeminiModelIdFromTierEnv } from "./geminiModelIds.ts";

const BACKGROUND_PRIMARY_ATTEMPTS = 3;
const BACKGROUND_PRIMARY_RETRY_DELAY_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface LlmJsonResult {
  json: unknown;
  model: string;
  tokensUsed: number | null;
}

export function isDeepSeekModelId(modelId: string): boolean {
  const id = modelId.replace(/^models\//i, "").trim().toLowerCase();
  return id.startsWith("deepseek-");
}

function isRetryableLlmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b(429|502|503)\b/i.test(message) ||
    /service unavailable|high demand|resource exhausted|overloaded|timed out|timeout/i.test(message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** DeepSeek chat/completions (OpenAI-compatible), JSON mode. */
async function callDeepSeekJson(params: {
  model: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
}): Promise<LlmJsonResult> {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY")?.trim();
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY (required when AI_MODEL_* uses a deepseek-* model id)");
  }
  const baseURL = (Deno.env.get("DEEPSEEK_BASE_URL")?.trim() || "https://api.deepseek.com").replace(/\/$/, "");
  const res = await withTimeout(
    fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: [{ role: "user", content: params.prompt }],
        temperature: params.temperature,
        max_tokens: params.maxOutputTokens,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
      }),
    }),
    DEFAULT_TIMEOUT_MS,
    "DeepSeek",
  );
  if (!res.ok) {
    throw new Error(`DeepSeek failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("DeepSeek returned empty response");
  }
  return {
    json: JSON.parse(raw),
    model: params.model,
    tokensUsed: data?.usage?.total_tokens ?? null,
  };
}

/** Gemini generateContent (v1beta), JSON response mime. */
async function callGeminiJson(params: {
  model: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
}): Promise<LlmJsonResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  const res = await withTimeout(
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: params.prompt }] }],
          generationConfig: {
            temperature: params.temperature,
            maxOutputTokens: params.maxOutputTokens,
            responseMimeType: "application/json",
          },
        }),
      },
    ),
    DEFAULT_TIMEOUT_MS,
    "Gemini",
  );
  if (!res.ok) {
    throw new Error(`Gemini failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini returned empty response");
  return {
    json: JSON.parse(raw),
    model: params.model,
    tokensUsed: data?.usageMetadata?.totalTokenCount ?? null,
  };
}

async function tryModel(model: string, params: {
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
}): Promise<LlmJsonResult> {
  if (isDeepSeekModelId(model)) {
    return callDeepSeekJson({ model, ...params });
  }
  return callGeminiJson({ model, ...params });
}

/**
 * Generate JSON via the LLM. Resolves primary model from `modelHint` tier
 * (`AI_MODEL_STANDARD` / `AI_MODEL_PREMIUM`), falls back to `AI_MODEL_FALLBACK`.
 * On ANY primary failure (retryable after N attempts, or non-retryable
 * immediately) → falls back to the fallback model. Throws only if the fallback
 * also fails (or if no fallback is configured / equals primary).
 */
export async function generateGeminiJson(params: {
  prompt: string;
  modelHint: string | null | undefined;
  temperature: number | null | undefined;
  maxOutputTokens: number | null | undefined;
  backgroundRetryPrimary?: boolean;
  logTag?: string;
}): Promise<LlmJsonResult> {
  const tag = params.logTag ?? "llm";
  const primaryModel = resolveGeminiModelIdFromTierEnv(params.modelHint);
  const fallbackModel = resolveFallbackGeminiModelIdFromEnv();
  const callParams = {
    prompt: params.prompt,
    temperature: params.temperature ?? 0.85,
    maxOutputTokens: params.maxOutputTokens ?? 2200,
  };

  const primaryAttempts = params.backgroundRetryPrimary ? BACKGROUND_PRIMARY_ATTEMPTS : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= primaryAttempts; attempt += 1) {
    try {
      return await tryModel(primaryModel, callParams);
    } catch (error) {
      lastError = error;
      if (isRetryableLlmError(error) && attempt < primaryAttempts) {
        console.warn(
          `[${tag}] primary model ${primaryModel} failed, ` +
            `retry ${attempt + 1}/${primaryAttempts} in ${Math.round(BACKGROUND_PRIMARY_RETRY_DELAY_MS / 1000)}s`,
          error,
        );
        await sleep(BACKGROUND_PRIMARY_RETRY_DELAY_MS);
        continue;
      }
      // Non-retryable, or attempts exhausted → fall through to fallback.
      break;
    }
  }

  if (fallbackModel === primaryModel) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? `${tag} failed`));
  }
  console.warn(
    `[${tag}] falling back from ${primaryModel} to ${fallbackModel}`,
    lastError,
  );
  return await tryModel(fallbackModel, callParams);
}
