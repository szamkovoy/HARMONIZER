import { GoogleGenerativeAI } from "@google/generative-ai";

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

export function getModelByHint(hint: string | null | undefined): string {
  const rawHint = hint?.trim() ?? "";
  const tier = rawHint.toLowerCase();
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

function modelChain(preferred?: string | null, fallbackModels?: readonly string[]): string[] {
  const primary = preferred?.trim() || getModelByHint("standard");
  const fallbacks = fallbackModels?.length ? fallbackModels : [];
  return [primary, ...fallbacks.filter((model) => model !== primary)];
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

  for (const modelId of modelChain(options.model, options.fallbackModels)) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature: options.temperature ?? 0.4,
          maxOutputTokens: options.maxOutputTokens ?? 1500,
          responseMimeType: "application/json",
        },
      });
      const result = await withGeminiTimeout(model.generateContent(options.prompt));
      const rawText = result.response.text();
      return { json: extractJson(rawText) as T, rawText, modelUsed: modelId };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /404|429|503|not\s*found|NOT_FOUND|UNAVAILABLE|overloaded|Resource exhausted/i.test(message);
      if (!retryable) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini generation failed");
}

export async function generateGeminiText(options: GenerateTextOptions): Promise<{ text: string; modelUsed: string }> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  let lastError: unknown;

  for (const modelId of modelChain(options.model, options.fallbackModels)) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 400,
          responseMimeType: options.responseMimeType ?? "text/plain",
        },
      });
      const result = await withGeminiTimeout(model.generateContent(options.prompt));
      return { text: result.response.text(), modelUsed: modelId };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /404|429|503|not\s*found|NOT_FOUND|UNAVAILABLE|overloaded|Resource exhausted/i.test(message);
      if (!retryable) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini generation failed");
}

export async function* streamGeminiText(options: GenerateTextOptions): AsyncGenerator<{ text: string; modelUsed: string }> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  let lastError: unknown;

  for (const modelId of modelChain(options.model, options.fallbackModels)) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 400,
          responseMimeType: options.responseMimeType ?? "text/plain",
        },
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
      const retryable = /404|429|503|not\s*found|NOT_FOUND|UNAVAILABLE|overloaded|Resource exhausted/i.test(message);
      if (!retryable) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini streaming failed");
}
