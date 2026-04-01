import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content, GenerateContentStreamResult } from "@google/generative-ai";

export const runtime = "nodejs";

type IncomingHistory = { role: "user" | "assistant"; content: string };

type Body = {
  systemInstruction: string;
  history: IncomingHistory[];
  input:
    | { type: "text"; text: string }
    | { type: "audio"; mimeType: string; base64: string };
};

/** Официальные model code (Google AI, 2026): отдельных `gemini-3.1-flash` / `gemini-3.1-flash-preview` нет — см. доки. */
const MODEL_CHAIN_DEFAULT = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-2.5-flash",
] as const;

function resolveModelChain(): string[] {
  const override = process.env.GEMINI_MODEL?.trim();
  if (!override) return [...MODEL_CHAIN_DEFAULT];
  const rest = MODEL_CHAIN_DEFAULT.filter((m) => m !== override);
  return [override, ...rest];
}

function isTransientModelError(message: string): boolean {
  return /503|429|UNAVAILABLE|high demand|overloaded|Resource exhausted|try again later/i.test(
    message,
  );
}

async function generateContentStreamWithFallback(
  genAI: GoogleGenerativeAI,
  contents: Content[],
  modelIds: string[],
): Promise<{ result: GenerateContentStreamResult; modelUsed: string }> {
  let lastError: Error | null = null;

  for (let i = 0; i < modelIds.length; i++) {
    const id = modelIds[i];
    try {
      const model = genAI.getGenerativeModel({ model: id });
      const result = await model.generateContentStream({ contents });
      if (i > 0) {
        console.warn(`[communicator] using fallback model: ${id}`);
      }
      return { result, modelUsed: id };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const msg = lastError.message;
      const canRetry = isTransientModelError(msg) && i < modelIds.length - 1;
      console.warn(`[communicator] model ${id} failed:`, msg.slice(0, 200));
      if (canRetry) continue;
      throw lastError;
    }
  }

  throw lastError ?? new Error("No models in chain");
}

function getApiKey(): string | null {
  return (process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? "") || null;
}

function toGeminiContents(
  systemPrompt: string,
  history: IncomingHistory[],
  input: Body["input"],
): Content[] {
  const contents: Content[] = [];

  contents.push({
    role: "user",
    parts: [{ text: `ИНСТРУКЦИЯ: ${systemPrompt}` }],
  });

  contents.push({
    role: "model",
    parts: [{ text: "Принято. Я готов соблюдать формат [T]." }],
  });

  for (const h of history) {
    contents.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    });
  }

  if (input.type === "text") {
    contents.push({
      role: "user",
      parts: [{ text: input.text }],
    });
  } else {
    contents.push({
      role: "user",
      parts: [
        { inlineData: { mimeType: input.mimeType, data: input.base64 } },
        {
          text: "Выполни инструкции: сначала [T]транскрипция[/T], затем ответ.",
        },
      ],
    });
  }
  return contents;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const apiKey = getApiKey();

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API Key not found" }), {
        status: 500,
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelChain = resolveModelChain();

    const fullInstruction = `${body.systemInstruction.trim()}\n\nВАЖНО: Ответ начинай с [T]транскрипции[/T].`;
    const contents = toGeminiContents(
      fullInstruction,
      body.history ?? [],
      body.input,
    );

    const { result } = await generateContentStreamWithFallback(
      genAI,
      contents,
      modelChain,
    );

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            if (req.signal.aborted) break;
            const text = chunk.text();
            if (text) controller.enqueue(encoder.encode(text));
          }
          controller.close();
        } catch (streamErr) {
          console.error("[communicator] stream", streamErr);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation error";
    console.error("Critical Error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
}
