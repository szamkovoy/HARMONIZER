import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content } from "@google/generative-ai";

// Используем 'edge', чтобы стриминг работал максимально быстро на Vercel
export const runtime = "edge";

const MODEL_ID = "gemini-1.5-flash";

type IncomingHistory = { role: "user" | "assistant"; content: string };

type Body = {
  systemInstruction: string;
  history: IncomingHistory[];
  input:
    | { type: "text"; text: string }
    | { type: "audio"; mimeType: string; base64: string };
};

// Функция поиска API-ключа в .env.local
function getApiKey(): string {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
  if (!key) {
    throw new Error("API Key не найден. Проверьте GOOGLE_AI_API_KEY в .env.local");
  }
  return key;
}

// Преобразование истории и ввода в формат Gemini
function toGeminiContents(
  history: IncomingHistory[],
  input: Body["input"]
): Content[] {
  const contents: Content[] = [];

  // Добавляем историю сообщений (если она есть)
  for (const h of history) {
    contents.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    });
  }

  // Добавляем текущий ввод пользователя
  if (input.type === "text") {
    contents.push({
      role: "user",
      parts: [{ text: `[T]${input.text}[/T]\n\nТеперь ответь на это.` }],
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
          text: "Транскрибируй мою речь в тегах [T]...[/T], а затем дай свой ответ.",
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
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(getApiKey());
  
  // Объединяем вашу роль (психолог) с правилом форматирования
  const fullInstruction = `${body.systemInstruction}\n\nВАЖНО: Твой ответ ВСЕГДА должен начинаться с транскрипции слов пользователя, заключенной в теги [T] и [/T]. Только после этого пиши свой ответ.`;

  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    systemInstruction: fullInstruction,
  });

  const contents = toGeminiContents(body.history ?? [], body.input);
  const encoder = new TextEncoder();

  try {
    const result = await model.generateContentStream({ contents });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            // Если пользователь нажал "Отмена" (AbortController), прекращаем стрим
            if (req.signal.aborted) break;
            
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (err) {
          console.error("Stream Error:", err);
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
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
}