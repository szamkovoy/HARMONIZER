import { getCommunicatorApiUrl } from "@/services/communicatorConfig";

export interface StreamChatTextInput {
  type: "text";
  text: string;
}

export interface StreamChatAudioInput {
  type: "audio";
  mimeType: string;
  base64: string;
}

export interface StreamChatRequest {
  systemInstruction: string;
  history: { role: "user" | "assistant"; content: string }[];
  input: StreamChatTextInput | StreamChatAudioInput;
  signal?: AbortSignal;
}

/**
 * POST /api/communicator — поток текста UTF-8 (как в `_legacy_web/app/api/communicator/route.ts`).
 */
export async function streamCommunicatorChat(
  req: StreamChatRequest,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(getCommunicatorApiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: req.systemInstruction,
      history: req.history,
      input: req.input,
    }),
    signal: req.signal,
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `HTTP ${res.status}`);
    }
    const errText = await res.text().catch(() => res.statusText);
    const looksLikeHtml =
      errText.trimStart().startsWith("<!") || /<html[\s>]/i.test(errText);
    if (looksLikeHtml) {
      throw new Error(
        `Сервер вернул HTML вместо API (${res.status}). Проверьте EXPO_PUBLIC_COMMUNICATOR_API_URL и ключ GOOGLE_AI_API_KEY на сервере.`,
      );
    }
    throw new Error(errText.slice(0, 280) || `HTTP ${res.status}`);
  }

  if (!res.body) {
    throw new Error("No response body");
  }

  return res.body;
}

export async function readTextStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) onChunk(decoder.decode(value, { stream: true }));
    }
    if (!signal?.aborted) onChunk(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
