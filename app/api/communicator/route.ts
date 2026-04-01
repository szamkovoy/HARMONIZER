import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content } from "@google/generative-ai";

/** Node: SDK Gemini не рассчитан на Edge — иначе часто 500 и HTML-страница ошибки Next. */
export const runtime = "nodejs";

const MODEL_ID = "gemini-1.5-flash";

type IncomingHistory = { role: "user" | "assistant"; content: string };

type Body = {
  systemInstruction: string;
  history: IncomingHistory[];
  input:
    | { type: "text"; text: string }
    | { type: "audio"; mimeType: string; base64: string };
};

function getApiKey(): string | null {
  return (
    process.env.GOOGLE_AI_API_KEY ??
    process.env.GEMINI_API_KEY ??
    ""
  ) || null;
}

function toGeminiContents(
  history: IncomingHistory[],
  input: Body["input"],
): Content[] {
  const contents: Content[] = [];

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
        {
          inlineData: {
            mimeType: input.mimeType,
            data: input.base64,
          },
        },
        {
          text: "Выполни инструкции по формату ответа: сначала [T]транскрипция[/T], затем ответ.",
        },
      ],
    });
  }

  return contents;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body?.systemInstruction?.trim() || !body?.input) {
    return new Response(
      JSON.stringify({ error: "systemInstruction and input required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "Missing GOOGLE_AI_API_KEY or GEMINI_API_KEY on the server (e.g. .env.local or Vercel env).",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const signal = req.signal;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const fullInstruction = `${body.systemInstruction.trim()}\n\nВАЖНО: Сначала выведи транскрипцию в тегах [T] и [/T], затем ответ.`;

    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction: fullInstruction,
    });

    const contents = toGeminiContents(body.history ?? [], body.input);
    const encoder = new TextEncoder();

    const result = await model.generateContentStream({ contents });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            if (signal.aborted) break;
            const text = chunk.text();
            if (text) controller.enqueue(encoder.encode(text));
          }
          controller.close();
        } catch (err) {
          if (signal.aborted) {
            controller.close();
            return;
          }
          console.error("[communicator] stream", err);
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
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
