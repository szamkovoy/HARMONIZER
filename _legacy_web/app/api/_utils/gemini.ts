import { createHash } from "node:crypto";

import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";

import {
  generateDeepSeekChatJson,
  generateDeepSeekChatText,
  isDeepSeekModelId,
  streamDeepSeekChatText,
} from "@legacy/app/api/_utils/deepseekOpenAi";

export interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

type GeminiBaseRequest = {
  model?: string | null;
  fallbackModels?: readonly string[];
  fallbackBehavior?: "immediate" | "background_primary_retries";
  sameModelRetryDelaysMs?: readonly number[];
  temperature?: number | null;
  maxOutputTokens?: number | null;
  responseMimeType?: "text/plain" | "application/json";
  /** Per-request LLM timeout; overrides GEMINI_TIMEOUT_MS / DEEPSEEK_TIMEOUT_MS when > 0. */
  timeoutMs?: number | null;
};

type GeminiLegacyPromptRequest = GeminiBaseRequest & {
  prompt: string;
};

export interface GeminiStructuredRequest extends GeminiBaseRequest {
  systemInstruction?: string;
  contents: GeminiContent[];
  cachedContent?: string;
}

type GenerateJsonOptions = GeminiLegacyPromptRequest | GeminiStructuredRequest;
type GenerateTextOptions = GenerateJsonOptions;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DEEPSEEK_TIMEOUT_MS = 60_000;
const DEFAULT_BACKGROUND_PRIMARY_RETRY_DELAYS_MS = [60_000, 60_000] as const;
const DIALOG_CACHE_TTL_SEC = 600;
const DEFAULT_CACHE_MIN_TOKENS = 32_768;
const MODEL_CACHE_MIN_TOKENS: Record<string, number> = {
  "gemini-3-flash-preview": 1024,
  "gemini-2.5-flash": 1024,
};
const dialogCacheStore = new Map<string, { name: string; expiresAt: number }>();

/** Разрешить только при явном ALLOW_LEGACY_GEMINI_MODELS=true — иначе используется ровно значение из env. */
const LEGACY_MODEL_UPGRADES: Record<string, string> = {
  "gemini-1.5-flash": "gemini-2.5-flash",
  "gemini-1.5-pro": "gemini-2.5-flash",
};

/** Informal names (docs/marketing) → ids that exist on generativelanguage.googleapis.com v1beta. */
const INFORMAL_GEMINI_MODEL_IDS: Record<string, string> = {
  "gemini-3.1-flash": "gemini-3-flash-preview",
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
};

export class GeminiJsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GeminiJsonParseError";
  }
}

class GeminiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Gemini request timed out after ${timeoutMs}ms`);
    this.name = "GeminiTimeoutError";
  }
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  return key;
}

function resolvePublishedGeminiModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const lower = trimmed.toLowerCase();
  if (process.env.ALLOW_LEGACY_GEMINI_MODELS === "true" && LEGACY_MODEL_UPGRADES[lower]) {
    return LEGACY_MODEL_UPGRADES[lower];
  }
  return INFORMAL_GEMINI_MODEL_IDS[lower] ?? trimmed;
}

function resolveEnvModelId(name: "AI_MODEL_STANDARD" | "AI_MODEL_PREMIUM" | "AI_MODEL_FALLBACK" | "AI_MODEL_LOW"): string | null {
  const model = process.env[name]?.trim();
  if (!model) return null;
  return resolvePublishedGeminiModelId(model);
}

/**
 * Подсказка tier из промпта или явное имя модели → id для Gemini API.
 * При `options.fallback === true` — резервная модель из `AI_MODEL_FALLBACK`.
 */
export function getModelByHint(hint: string | null | undefined, options?: { fallback?: boolean }): string {
  const rawHint = hint?.trim() ?? "";
  const tier = rawHint.toLowerCase();

  if (options?.fallback) {
    const model = process.env.AI_MODEL_FALLBACK?.trim();
    if (!model) {
      throw new Error("Missing AI_MODEL_FALLBACK environment variable");
    }
    const fb = model.toLowerCase();
    if (fb.startsWith("deepseek-")) return model;
    return resolvePublishedGeminiModelId(model);
  }

  if (tier.startsWith("gemini-")) {
    return resolvePublishedGeminiModelId(rawHint);
  }
  if (tier.startsWith("deepseek-")) {
    return rawHint.trim();
  }
  const model =
    tier === "premium"
      ? process.env.AI_MODEL_PREMIUM?.trim()
      : tier === "low"
        ? (process.env.AI_MODEL_LOW?.trim() || process.env.AI_MODEL_STANDARD?.trim())
        : process.env.AI_MODEL_STANDARD?.trim();
  if (!model) {
    throw new Error(
      tier === "premium"
        ? "Missing AI_MODEL_PREMIUM environment variable"
        : tier === "low"
          ? "Missing AI_MODEL_LOW or AI_MODEL_STANDARD environment variable"
          : "Missing AI_MODEL_STANDARD environment variable",
    );
  }
  const ml = model.toLowerCase();
  if (ml.startsWith("deepseek-")) return model;
  return resolvePublishedGeminiModelId(model);
}

export function supportsExplicitLlmCache(modelId: string | null | undefined): boolean {
  const trimmed = modelId?.trim();
  if (!trimmed) return false;
  return !isDeepSeekModelId(trimmed);
}

function httpStatusFromUnknown(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const s = (error as { status: unknown }).status;
    return typeof s === "number" && Number.isFinite(s) ? s : undefined;
  }
  return undefined;
}

/** Перегрузка / rate limit: и по тексту ошибки Gemini, и по HTTP-статусу OpenAI-совместимых клиентов (DeepSeek). */
function isRetryableLlmError(error: unknown): boolean {
  const status = httpStatusFromUnknown(error);
  if (status === 429 || status === 503 || status === 502) return true;
  const message = error instanceof Error ? error.message : String(error);
  return isRetryableGeminiOverloadMessage(message);
}

function isRetryableGeminiOverloadMessage(message: string): boolean {
  return (
    /\b503\b/i.test(message) ||
    /service unavailable/i.test(message) ||
    /high demand/i.test(message) ||
    /\b429\b/i.test(message) ||
    /rate_limit_exceeded/i.test(message) ||
    /\bUNAVAILABLE\b/i.test(message) ||
    /overloaded/i.test(message) ||
    /resource exhausted/i.test(message) ||
    /timed out/i.test(message) ||
    /timeout/i.test(message)
  );
}

function overloadReasonSnippet(message: string): string {
  const m = message.trim();
  const status = m.match(/\b(429|503)\b/)?.[1];
  if (status) return status;
  if (/high demand/i.test(m)) return "high demand";
  if (/RATE_LIMIT_EXCEEDED/i.test(m)) return "RATE_LIMIT_EXCEEDED";
  if (/Service Unavailable/i.test(m)) return "Service Unavailable";
  return "overload";
}

function geminiUserFacingUnavailableMessage(): string {
  return "Сервис временно недоступен, попробуйте через минуту";
}

function isOverloadLikeForPublicMessage(message: string): boolean {
  return (
    /\b503\b/i.test(message) ||
    /service unavailable/i.test(message) ||
    /high demand/i.test(message) ||
    /\b429\b/i.test(message) ||
    /rate_limit_exceeded/i.test(message) ||
    /\bUNAVAILABLE\b/i.test(message) ||
    /overloaded/i.test(message) ||
    /resource exhausted/i.test(message)
  );
}

function throwFinalGeminiError(lastError: unknown): never {
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  if (isOverloadLikeForPublicMessage(msg)) {
    throw new Error(geminiUserFacingUnavailableMessage());
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function geminiAttemptModelChain(preferred?: string | null, extraFallbacks?: readonly string[]): string[] {
  const primary = preferred?.trim() || getModelByHint("standard");
  const fallback = resolveEnvModelId("AI_MODEL_FALLBACK");
  const tail: string[] = [];

  if (fallback != null && fallback !== primary) {
    tail.push(fallback);
  }

  tail.push(...(extraFallbacks ?? []));
  const out: string[] = [];
  for (const id of [primary, ...tail]) {
    const trimmed = id?.trim();
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function getModelAttemptChainForTest(preferred?: string | null, extraFallbacks?: readonly string[]): string[] {
  return geminiAttemptModelChain(preferred, extraFallbacks);
}

function normalizeSameModelRetryDelays(delays: readonly number[] | undefined): number[] {
  if (!delays?.length) return [...DEFAULT_BACKGROUND_PRIMARY_RETRY_DELAYS_MS];
  return delays
    .map((value) => Math.round(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function backgroundRetryDelaysFor(options: GeminiBaseRequest): number[] {
  if (options.fallbackBehavior !== "background_primary_retries") return [];
  return normalizeSameModelRetryDelays(options.sameModelRetryDelaysMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutMs(): number {
  const value = Number(process.env.GEMINI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function deepseekTimeoutMs(): number {
  const value = Number(process.env.DEEPSEEK_TIMEOUT_MS ?? DEFAULT_DEEPSEEK_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_DEEPSEEK_TIMEOUT_MS;
}

function resolveRequestTimeoutMs(options: GeminiBaseRequest, kind: "gemini" | "deepseek"): number {
  const override = Number(options.timeoutMs);
  if (Number.isFinite(override) && override > 0) return override;
  return kind === "deepseek" ? deepseekTimeoutMs() : timeoutMs();
}

async function withLlmTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new GeminiTimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withGeminiTimeout<T>(promise: Promise<T>): Promise<T> {
  return withLlmTimeout(promise, timeoutMs());
}

async function withDeepSeekTimeout<T>(promise: Promise<T>): Promise<T> {
  return withLlmTimeout(promise, deepseekTimeoutMs());
}

function thinkingConfigForDialogModel(modelId: string): Record<string, unknown> | undefined {
  const id = modelId.replace(/^models\//i, "").toLowerCase();
  if (id.startsWith("gemini-2.5")) {
    return { thinkingConfig: { thinkingBudget: 0 } };
  }
  return undefined;
}

function buildGenerationConfig(
  modelId: string,
  base: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType?: string;
    responseSchema?: unknown;
  },
): GenerationConfig {
  const thinking = thinkingConfigForDialogModel(modelId);
  return {
    temperature: base.temperature,
    maxOutputTokens: base.maxOutputTokens,
    ...(base.responseMimeType ? { responseMimeType: base.responseMimeType } : {}),
    ...(base.responseSchema != null ? { responseSchema: base.responseSchema as GenerationConfig["responseSchema"] } : {}),
    ...(thinking ?? {}),
  } as GenerationConfig;
}

function toStructuredRequest(options: GenerateTextOptions): GeminiStructuredRequest {
  if ("contents" in options) {
    return {
      systemInstruction: options.systemInstruction,
      contents: options.contents,
      model: options.model,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      responseMimeType: options.responseMimeType,
      cachedContent: options.cachedContent,
      fallbackModels: options.fallbackModels,
    };
  }

  return {
    contents: [{ role: "user", parts: [{ text: options.prompt }] }],
    model: options.model,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    responseMimeType: options.responseMimeType,
    fallbackModels: options.fallbackModels,
  };
}

function systemInstructionPayload(text: string | undefined): { parts: Array<{ text: string }> } | undefined {
  const trimmed = text?.trim();
  return trimmed ? { parts: [{ text: trimmed }] } : undefined;
}

function buildRequestBody(modelId: string, request: GeminiStructuredRequest, responseMimeType: "text/plain" | "application/json") {
  const useCache = Boolean(request.cachedContent);
  return {
    contents: request.contents,
    ...(!useCache && systemInstructionPayload(request.systemInstruction)
      ? { systemInstruction: systemInstructionPayload(request.systemInstruction) }
      : {}),
    generationConfig: buildGenerationConfig(modelId, {
      temperature: request.temperature ?? (responseMimeType === "application/json" ? 0.4 : 0.7),
      maxOutputTokens: request.maxOutputTokens ?? (responseMimeType === "application/json" ? 1500 : 400),
      responseMimeType: request.responseMimeType ?? responseMimeType,
    }),
    ...(useCache ? { cachedContent: request.cachedContent } : {}),
  };
}

function pruneExpiredDialogCaches(now = Date.now()): void {
  for (const [key, entry] of dialogCacheStore.entries()) {
    if (entry.expiresAt <= now) dialogCacheStore.delete(key);
  }
}

function estimatedTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function cacheThresholdForModel(modelId: string): number {
  const normalized = modelId.replace(/^models\//i, "").toLowerCase();
  return MODEL_CACHE_MIN_TOKENS[normalized] ?? DEFAULT_CACHE_MIN_TOKENS;
}

function cacheablePrefixText(systemInstruction: string, contents: GeminiContent[]): string {
  return [systemInstruction, ...contents.flatMap((content) => content.parts.map((part) => part.text))].join("\n");
}

function dialogCacheKey(conversationId: string, historyHash: string): string {
  return `dialog_cache:${conversationId}:${historyHash}`;
}

function modelResourceName(modelId: string): string {
  return modelId.startsWith("models/") ? modelId : `models/${modelId}`;
}

export function getExplicitCacheMinTokens(modelId: string): number {
  return cacheThresholdForModel(modelId);
}

export async function ensureDialogCache(
  conversationId: string,
  systemInstruction: string,
  history: GeminiContent[],
  model: string,
): Promise<string | null> {
  if (!supportsExplicitLlmCache(model)) return null;
  const trimmedSystemInstruction = systemInstruction.trim();
  const cacheableHistory = history.filter((item) => item.parts.some((part) => part.text.trim().length > 0));
  if (!conversationId || !trimmedSystemInstruction || cacheableHistory.length === 0) return null;

  const prefixText = cacheablePrefixText(trimmedSystemInstruction, cacheableHistory);
  const estimatedTokens = estimatedTokenCount(prefixText);
  const minTokens = cacheThresholdForModel(model);
  if (estimatedTokens < minTokens) return null;

  pruneExpiredDialogCaches();
  const historyHash = createHash("sha256")
    .update(JSON.stringify({ model, systemInstruction: trimmedSystemInstruction, history: cacheableHistory }))
    .digest("hex");
  const key = dialogCacheKey(conversationId, historyHash);
  const now = Date.now();
  const cached = dialogCacheStore.get(key);
  if (cached && cached.expiresAt > now) return cached.name;

  try {
    const response = await withGeminiTimeout(
      fetch(`https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${encodeURIComponent(getApiKey())}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelResourceName(model),
          systemInstruction: { parts: [{ text: trimmedSystemInstruction }] },
          contents: cacheableHistory,
          ttl: `${DIALOG_CACHE_TTL_SEC}s`,
        }),
      }),
    );
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      if (response.status === 400 || response.status === 404) return null;
      console.warn(`[GEMINI CACHE] Failed to create cache (${response.status}): ${text.slice(0, 280)}`);
      return null;
    }

    const json = (await response.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof json?.name === "string" && json.name.trim() ? json.name.trim() : null;
    if (!name) return null;

    dialogCacheStore.set(key, {
      name,
      expiresAt: now + DIALOG_CACHE_TTL_SEC * 1000,
    });
    return name;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isRetryableGeminiOverloadMessage(message)) return null;
    console.warn(`[GEMINI CACHE] Cache create failed: ${message}`);
    return null;
  }
}

function normalizeJsonText(text: string): string {
  return text
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonCandidate(candidate: string): unknown {
  const parsed = JSON.parse(candidate);
  if (typeof parsed === "string" && /^[\s`]*[\[{]/.test(parsed)) {
    return JSON.parse(normalizeJsonText(parsed));
  }
  return parsed;
}

function balancedJsonSlice(text: string): string | null {
  const openIndex = text.search(/[\[{]/);
  if (openIndex < 0) return null;

  const open = text[openIndex];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) depth -= 1;
    if (depth === 0) return text.slice(openIndex, i + 1);
  }

  return text.slice(openIndex);
}

function repairJsonCandidate(candidate: string): string {
  return candidate
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([}\]"0-9])\s+(?="[\w-]+"\s*:)/g, "$1,")
    .replace(/\b(true|false|null)\s+(?="[\w-]+"\s*:)/g, "$1,");
}

export function extractJson(text: string): unknown {
  const normalized = normalizeJsonText(text);
  const candidates = [
    normalized,
    balancedJsonSlice(normalized),
    normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null,
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

  let lastError: unknown;
  for (const candidate of candidates) {
    for (const attempt of [candidate, repairJsonCandidate(candidate)]) {
      try {
        return parseJsonCandidate(attempt);
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new GeminiJsonParseError("Gemini response is not valid JSON", text, lastError);
}

export async function generateGeminiJson<T>(options: GenerateJsonOptions): Promise<{ json: T; rawText: string; modelUsed: string }> {
  let genAI: GoogleGenerativeAI | null = null;
  const geminiClient = () => {
    if (!genAI) genAI = new GoogleGenerativeAI(getApiKey());
    return genAI;
  };
  let lastError: unknown;
  const request = toStructuredRequest(options);
  const chain = geminiAttemptModelChain(request.model, request.fallbackModels);
  const primaryRetryDelays = backgroundRetryDelaysFor(options);
  const geminiRequestTimeoutMs = resolveRequestTimeoutMs(options, "gemini");
  const deepseekRequestTimeoutMs = resolveRequestTimeoutMs(options, "deepseek");

  for (let i = 0; i < chain.length; i += 1) {
    const modelId = chain[i]!;
    const effectiveRequest = i === 0 ? request : { ...request, cachedContent: undefined };
    const retryDelays = i === 0 ? primaryRetryDelays : [];
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        if (isDeepSeekModelId(modelId)) {
          const { rawText, modelUsed } = await withLlmTimeout(
            generateDeepSeekChatJson({
              model: modelId,
              systemInstruction: effectiveRequest.systemInstruction,
              contents: effectiveRequest.contents,
              temperature: effectiveRequest.temperature,
              maxOutputTokens: effectiveRequest.maxOutputTokens,
            }),
            deepseekRequestTimeoutMs,
          );
          return { json: extractJson(rawText) as T, rawText, modelUsed };
        }
        const model = geminiClient().getGenerativeModel({ model: modelId });
        const result = await withLlmTimeout(
          model.generateContent(buildRequestBody(modelId, effectiveRequest, "application/json") as never),
          geminiRequestTimeoutMs,
        );
        const rawText = result.response.text();
        return { json: extractJson(rawText) as T, rawText, modelUsed: modelId };
      } catch (error) {
        lastError = error;
        const retryable = isRetryableLlmError(error);
        if (!retryable) break;
        if (attempt < retryDelays.length) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const reason = overloadReasonSnippet(errMsg);
          const delayMs = retryDelays[attempt]!;
          console.warn(
            `[LLM RETRY] ${modelId} failed (${reason}): ${errMsg.slice(0, 200)}. ` +
            `Retrying same model in ${Math.round(delayMs / 1000)}s (${attempt + 2}/${retryDelays.length + 1})`,
          );
          await sleep(delayMs);
          continue;
        }
        const next = chain[i + 1];
        if (next) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const reason = overloadReasonSnippet(errMsg);
          console.warn(`[LLM FALLBACK] ${modelId} failed (${reason}): ${errMsg.slice(0, 200)}. Retrying with ${next}`);
        }
      }
      break;
    }
  }

  if (lastError === undefined) throw new Error("Gemini generation failed");
  throwFinalGeminiError(lastError);
}

export async function generateGeminiText(options: GenerateTextOptions): Promise<{ text: string; modelUsed: string }> {
  let genAI: GoogleGenerativeAI | null = null;
  const geminiClient = () => {
    if (!genAI) genAI = new GoogleGenerativeAI(getApiKey());
    return genAI;
  };
  let lastError: unknown;
  const request = toStructuredRequest(options);
  const chain = geminiAttemptModelChain(request.model, request.fallbackModels);
  const primaryRetryDelays = backgroundRetryDelaysFor(options);

  for (let i = 0; i < chain.length; i += 1) {
    const modelId = chain[i]!;
    const effectiveRequest = i === 0 ? request : { ...request, cachedContent: undefined };
    const retryDelays = i === 0 ? primaryRetryDelays : [];
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        if (isDeepSeekModelId(modelId)) {
          return await withDeepSeekTimeout(
            generateDeepSeekChatText({
              model: modelId,
              systemInstruction: effectiveRequest.systemInstruction,
              contents: effectiveRequest.contents,
              temperature: effectiveRequest.temperature,
              maxOutputTokens: effectiveRequest.maxOutputTokens,
            }),
          );
        }
        const model = geminiClient().getGenerativeModel({ model: modelId });
        const result = await withGeminiTimeout(
          model.generateContent(buildRequestBody(modelId, effectiveRequest, "text/plain") as never),
        );
        return { text: result.response.text(), modelUsed: modelId };
      } catch (error) {
        lastError = error;
        const retryable = isRetryableLlmError(error);
        if (!retryable) break;
        if (attempt < retryDelays.length) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const reason = overloadReasonSnippet(errMsg);
          const delayMs = retryDelays[attempt]!;
          console.warn(
            `[LLM RETRY] ${modelId} failed (${reason}): ${errMsg.slice(0, 200)}. ` +
            `Retrying same model in ${Math.round(delayMs / 1000)}s (${attempt + 2}/${retryDelays.length + 1})`,
          );
          await sleep(delayMs);
          continue;
        }
        const next = chain[i + 1];
        if (next) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const reason = overloadReasonSnippet(errMsg);
          console.warn(`[LLM FALLBACK] ${modelId} failed (${reason}): ${errMsg.slice(0, 200)}. Retrying with ${next}`);
        }
      }
      break;
    }
  }

  if (lastError === undefined) throw new Error("Gemini generation failed");
  throwFinalGeminiError(lastError);
}

export async function* streamGeminiText(options: GenerateTextOptions): AsyncGenerator<{ text: string; modelUsed: string }> {
  let genAI: GoogleGenerativeAI | null = null;
  const geminiClient = () => {
    if (!genAI) genAI = new GoogleGenerativeAI(getApiKey());
    return genAI;
  };
  let lastError: unknown;
  const request = toStructuredRequest(options);
  const chain = geminiAttemptModelChain(request.model, request.fallbackModels);
  const primaryRetryDelays = backgroundRetryDelaysFor(options);

  for (let i = 0; i < chain.length; i += 1) {
    const modelId = chain[i]!;
    const effectiveRequest = i === 0 ? request : { ...request, cachedContent: undefined };
    const retryDelays = i === 0 ? primaryRetryDelays : [];
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        if (isDeepSeekModelId(modelId)) {
          for await (const item of streamDeepSeekChatText({
            model: modelId,
            systemInstruction: effectiveRequest.systemInstruction,
            contents: effectiveRequest.contents,
            temperature: effectiveRequest.temperature,
            maxOutputTokens: effectiveRequest.maxOutputTokens,
          })) {
            yield item;
          }
          return;
        }
        const model = geminiClient().getGenerativeModel({ model: modelId });
        const result = await withGeminiTimeout(
          model.generateContentStream(buildRequestBody(modelId, effectiveRequest, "text/plain") as never),
        );
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) yield { text, modelUsed: modelId };
        }
        return;
      } catch (error) {
        lastError = error;
        const retryable = isRetryableLlmError(error);
        if (!retryable) break;
        if (attempt < retryDelays.length) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const reason = overloadReasonSnippet(errMsg);
          const delayMs = retryDelays[attempt]!;
          console.warn(
            `[LLM RETRY] ${modelId} failed (${reason}): ${errMsg.slice(0, 200)}. ` +
            `Retrying same model in ${Math.round(delayMs / 1000)}s (${attempt + 2}/${retryDelays.length + 1})`,
          );
          await sleep(delayMs);
          continue;
        }
        const next = chain[i + 1];
        if (next) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const reason = overloadReasonSnippet(errMsg);
          console.warn(`[LLM FALLBACK] ${modelId} failed (${reason}): ${errMsg.slice(0, 200)}. Retrying with ${next}`);
        }
      }
      break;
    }
  }

  if (lastError === undefined) throw new Error("Gemini streaming failed");
  throwFinalGeminiError(lastError);
}
