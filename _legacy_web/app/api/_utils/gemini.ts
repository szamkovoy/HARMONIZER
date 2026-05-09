import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
type GenerateJsonOptions = {
  prompt: string;
  model?: string | null;
  fallbackModels?: readonly string[];
  temperature?: number | null;
  maxOutputTokens?: number | null;
};

type GenerateTextOptions = GenerateJsonOptions & {
  responseMimeType?: "text/plain" | "application/json";
};

const DEFAULT_TIMEOUT_MS = 30_000;

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

/** Резолв основной premium-модели из env (без рекурсии в `getModelByHint`). */
function resolvePrimaryPremiumModelId(): string | null {
  const model = process.env.AI_MODEL_PREMIUM?.trim();
  if (!model) return null;
  return resolvePublishedGeminiModelId(model);
}

/**
 * Подсказка tier из промпта или явное имя модели → id для Gemini API.
 * При `options.fallback === true` — резервная модель из `AI_MODEL_*_FALLBACK` (см. `.env.example`).
 */
export function getModelByHint(hint: string | null | undefined, options?: { fallback?: boolean }): string {
  const rawHint = hint?.trim() ?? "";
  const tier = rawHint.toLowerCase();

  if (options?.fallback) {
    const premiumPrimary = resolvePrimaryPremiumModelId();
    const usePremium =
      tier === "premium" ||
      (tier.startsWith("gemini-") && premiumPrimary != null && resolvePublishedGeminiModelId(rawHint) === premiumPrimary);
    const model = usePremium ? process.env.AI_MODEL_PREMIUM_FALLBACK?.trim() : process.env.AI_MODEL_STANDARD_FALLBACK?.trim();
    if (!model) {
      throw new Error(
        usePremium ? "Missing AI_MODEL_PREMIUM_FALLBACK environment variable" : "Missing AI_MODEL_STANDARD_FALLBACK environment variable",
      );
    }
    return resolvePublishedGeminiModelId(model);
  }

  if (tier.startsWith("gemini-")) {
    return resolvePublishedGeminiModelId(rawHint);
  }
  const model = tier === "premium" ? process.env.AI_MODEL_PREMIUM?.trim() : process.env.AI_MODEL_STANDARD?.trim();
  if (!model) {
    throw new Error(
      tier === "premium" ? "Missing AI_MODEL_PREMIUM environment variable" : "Missing AI_MODEL_STANDARD environment variable",
    );
  }
  return resolvePublishedGeminiModelId(model);
}

function overloadTierForPrimaryModel(primary: string): "standard" | "premium" {
  const premiumPrimary = resolvePrimaryPremiumModelId();
  if (premiumPrimary != null && primary === premiumPrimary) return "premium";
  return "standard";
}

function isRetryableGeminiOverloadMessage(message: string): boolean {
  return (
    /\b503\b/i.test(message) ||
    /service unavailable/i.test(message) ||
    /high demand/i.test(message) ||
    /\b429\b/i.test(message) ||
    /rate_limit_exceeded/i.test(message) ||
    /not\s*found/i.test(message) ||
    /\b404\b/.test(message) ||
    /\bNOT_FOUND\b/.test(message) ||
    /\bUNAVAILABLE\b/i.test(message) ||
    /overloaded/i.test(message) ||
    /resource exhausted/i.test(message)
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
  const tier = overloadTierForPrimaryModel(primary);
  let envFallback: string | undefined;
  try {
    const fb = getModelByHint(tier, { fallback: true });
    if (fb !== primary) envFallback = fb;
  } catch {
    /* резервные модели в env не заданы — цепочка только из primary */
  }
  const tail = [...(envFallback ? [envFallback] : []), ...(extraFallbacks ?? [])];
  const out: string[] = [];
  for (const id of [primary, ...tail]) {
    const trimmed = id?.trim();
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function timeoutMs(): number {
  const value = Number(process.env.GEMINI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function withGeminiTimeout<T>(promise: Promise<T>): Promise<T> {
  const ms = timeoutMs();
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

/**
 * Gemini 2.5 по умолчанию тратит «мыслительные» токены из того же бюджета, что и видимый текст — обрывы
 * посреди фразы при умеренном maxOutputTokens. Для 2.5 отключаем thinking; линейка 3.x не трогаем —
 * остаётся глубина по умолчанию API (ограничение — maxOutputTokens на маршруте).
 * @see https://firebase.google.com/docs/ai-logic/thinking
 */
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
  const genAI = new GoogleGenerativeAI(getApiKey());
  let lastError: unknown;
  const chain = geminiAttemptModelChain(options.model, options.fallbackModels);

  for (let i = 0; i < chain.length; i += 1) {
    const modelId = chain[i]!;
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: buildGenerationConfig(modelId, {
          temperature: options.temperature ?? 0.4,
          maxOutputTokens: options.maxOutputTokens ?? 1500,
          responseMimeType: "application/json",
        }),
      });
      const result = await withGeminiTimeout(model.generateContent(options.prompt));
      const rawText = result.response.text();
      return { json: extractJson(rawText) as T, rawText, modelUsed: modelId };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableGeminiOverloadMessage(message);
      if (!retryable) break;
      const next = chain[i + 1];
      if (next) {
        const reason = overloadReasonSnippet(message);
        console.warn(`[GEMINI FALLBACK] Primary model ${modelId} returned ${reason}, retrying with ${next}`);
      }
    }
  }

  if (lastError === undefined) throw new Error("Gemini generation failed");
  throwFinalGeminiError(lastError);
}

export async function generateGeminiText(options: GenerateTextOptions): Promise<{ text: string; modelUsed: string }> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  let lastError: unknown;
  const chain = geminiAttemptModelChain(options.model, options.fallbackModels);

  for (let i = 0; i < chain.length; i += 1) {
    const modelId = chain[i]!;
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: buildGenerationConfig(modelId, {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 400,
          responseMimeType: options.responseMimeType ?? "text/plain",
        }),
      });
      const result = await withGeminiTimeout(model.generateContent(options.prompt));
      return { text: result.response.text(), modelUsed: modelId };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableGeminiOverloadMessage(message);
      if (!retryable) break;
      const next = chain[i + 1];
      if (next) {
        const reason = overloadReasonSnippet(message);
        console.warn(`[GEMINI FALLBACK] Primary model ${modelId} returned ${reason}, retrying with ${next}`);
      }
    }
  }

  if (lastError === undefined) throw new Error("Gemini generation failed");
  throwFinalGeminiError(lastError);
}

export async function* streamGeminiText(options: GenerateTextOptions): AsyncGenerator<{ text: string; modelUsed: string }> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  let lastError: unknown;
  const chain = geminiAttemptModelChain(options.model, options.fallbackModels);

  for (let i = 0; i < chain.length; i += 1) {
    const modelId = chain[i]!;
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: buildGenerationConfig(modelId, {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 400,
          responseMimeType: options.responseMimeType ?? "text/plain",
        }),
      });
      const result = await withGeminiTimeout(model.generateContentStream(options.prompt));
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield { text, modelUsed: modelId };
      }
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableGeminiOverloadMessage(message);
      if (!retryable) break;
      const next = chain[i + 1];
      if (next) {
        const reason = overloadReasonSnippet(message);
        console.warn(`[GEMINI FALLBACK] Primary model ${modelId} returned ${reason}, retrying with ${next}`);
      }
    }
  }

  if (lastError === undefined) throw new Error("Gemini streaming failed");
  throwFinalGeminiError(lastError);
}
