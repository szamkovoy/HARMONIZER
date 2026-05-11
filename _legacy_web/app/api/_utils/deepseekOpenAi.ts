import OpenAI from "openai";

/** Same shape as Gemini `contents` rows; kept local to avoid circular imports with `gemini.ts`. */
export type StructuredChatRow = { role: "user" | "model"; parts: { text: string }[] };

export function isDeepSeekModelId(modelId: string): boolean {
  const id = modelId.replace(/^models\//i, "").trim().toLowerCase();
  return id.startsWith("deepseek-");
}

let _client: OpenAI | null = null;

function getDeepSeekClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY (required when AI_MODEL_* uses a deepseek-* model id)");
  }
  const rawBase = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
  const baseURL = rawBase.replace(/\/$/, "");
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

export function structuredContentsToOpenAiMessages(
  systemInstruction: string | undefined,
  contents: StructuredChatRow[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  const sys = systemInstruction?.trim();
  if (sys) messages.push({ role: "system", content: sys });
  for (const row of contents) {
    const text = row.parts.map((p) => p.text).join("\n");
    if (!text.trim()) continue;
    const role = row.role === "model" ? "assistant" : "user";
    messages.push({ role, content: text });
  }
  return messages;
}

// TEMPORARY: full diagnostic logging for premium-call testing (remove after stable)
function diagLog(label: string, body: Record<string, unknown>, startMs: number): void {
  const { messages, ...rest } = body;
  const msgFull = Array.isArray(messages)
    ? messages.map((m: Record<string, unknown>) => ({
        role: m.role,
        content: m.content,
      }))
    : [];
  console.log(`[DEEPSEEK_DIAG] ${label}`, JSON.stringify({
    model: rest.model,
    temperature: rest.temperature,
    max_tokens: rest.max_tokens,
    thinking: rest.thinking,
    stream: rest.stream,
    messagesCount: msgFull.length,
    messages: msgFull,
    elapsedMs: Date.now() - startMs,
  }));
}

function diagLogResponse(label: string, text: string, startMs: number): void {
  console.log(`[DEEPSEEK_DIAG] ${label} response`, JSON.stringify({
    elapsedMs: Date.now() - startMs,
    textLen: text.length,
    fullText: text,
  }));
}

export async function generateDeepSeekChatText(params: {
  model: string;
  systemInstruction?: string;
  contents: StructuredChatRow[];
  temperature?: number | null;
  maxOutputTokens?: number | null;
}): Promise<{ text: string; modelUsed: string }> {
  const openai = getDeepSeekClient();
  const messages = structuredContentsToOpenAiMessages(params.systemInstruction, params.contents);
  const startMs = Date.now();
  const body = {
    model: params.model,
    messages,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxOutputTokens ?? 1500,
    thinking: { type: "disabled" },
  };
  diagLog("generateText", body as unknown as Record<string, unknown>, startMs);
  const res = await openai.chat.completions.create(body);
  const text = res.choices[0]?.message?.content ?? "";
  const result = typeof text === "string" ? text : "";
  diagLogResponse("generateText", result, startMs);
  return { text: result, modelUsed: params.model };
}

export async function* streamDeepSeekChatText(params: {
  model: string;
  systemInstruction?: string;
  contents: StructuredChatRow[];
  temperature?: number | null;
  maxOutputTokens?: number | null;
}): AsyncGenerator<{ text: string; modelUsed: string }> {
  const openai = getDeepSeekClient();
  const messages = structuredContentsToOpenAiMessages(params.systemInstruction, params.contents);
  const startMs = Date.now();
  const body = {
    model: params.model,
    messages,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxOutputTokens ?? 1500,
    stream: true as const,
    thinking: { type: "disabled" },
  };
  diagLog("streamText", body as unknown as Record<string, unknown>, startMs);
  const stream = await openai.chat.completions.create(body);
  const modelUsed = params.model;
  let firstChunk = true;
  let totalLen = 0;
  let collectedText = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      if (firstChunk) {
        console.log(`[DEEPSEEK_DIAG] streamText first_chunk_ms=${Date.now() - startMs}`);
        firstChunk = false;
      }
      totalLen += delta.length;
      collectedText += delta;
      yield { text: delta, modelUsed };
    }
  }
  console.log(`[DEEPSEEK_DIAG] streamText done`, JSON.stringify({ totalLen, elapsedMs: Date.now() - startMs, fullText: collectedText }));
}

export async function generateDeepSeekChatJson(params: {
  model: string;
  systemInstruction?: string;
  contents: StructuredChatRow[];
  temperature?: number | null;
  maxOutputTokens?: number | null;
}): Promise<{ rawText: string; modelUsed: string }> {
  const openai = getDeepSeekClient();
  const messages = structuredContentsToOpenAiMessages(params.systemInstruction, params.contents);
  const startMs = Date.now();
  const body = {
    model: params.model,
    messages,
    temperature: params.temperature ?? 0.4,
    max_tokens: params.maxOutputTokens ?? 1500,
    response_format: { type: "json_object" as const },
    thinking: { type: "disabled" },
  };
  diagLog("generateJson", body as unknown as Record<string, unknown>, startMs);
  const res = await openai.chat.completions.create(body);
  const text = res.choices[0]?.message?.content ?? "";
  const result = typeof text === "string" ? text : "";
  diagLogResponse("generateJson", result, startMs);
  return { rawText: result, modelUsed: params.model };
}
