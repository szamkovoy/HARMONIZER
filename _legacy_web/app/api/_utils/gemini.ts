import { GoogleGenerativeAI } from "@google/generative-ai";

type GenerateJsonOptions = {
  prompt: string;
  model?: string | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
};

type GenerateTextOptions = GenerateJsonOptions & {
  responseMimeType?: "text/plain" | "application/json";
};

const DEFAULT_MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"] as const;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  return key;
}

function modelChain(preferred?: string | null): string[] {
  const override = preferred?.trim() || process.env.GEMINI_MODEL?.trim();
  if (!override) return [...DEFAULT_MODEL_CHAIN];
  return [override, ...DEFAULT_MODEL_CHAIN.filter((model) => model !== override)];
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("Gemini response is not valid JSON");
  }
}

export async function generateGeminiJson<T>(options: GenerateJsonOptions): Promise<{ json: T; rawText: string; modelUsed: string }> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  let lastError: unknown;

  for (const modelId of modelChain(options.model)) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature: options.temperature ?? 0.4,
          maxOutputTokens: options.maxOutputTokens ?? 1500,
          responseMimeType: "application/json",
        },
      });
      const result = await model.generateContent(options.prompt);
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

  for (const modelId of modelChain(options.model)) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 400,
          responseMimeType: options.responseMimeType ?? "text/plain",
        },
      });
      const result = await model.generateContent(options.prompt);
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

  for (const modelId of modelChain(options.model)) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 400,
          responseMimeType: options.responseMimeType ?? "text/plain",
        },
      });
      const result = await model.generateContentStream(options.prompt);
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
