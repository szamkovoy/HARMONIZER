import {
  readTextStream,
  streamCommunicatorChat,
  type StreamChatRequest,
} from "../api/communicator-client";
import {
  parseTranscriptStream,
  type ParsedStreamParts,
} from "../core/transcript-parser";

export type CommunicatorStreamChunk = {
  raw: string;
  /** Текст внутри [T]…[/T] и ответ после тегов — см. `parseTranscriptStream` */
  parsed: ParsedStreamParts;
};

/**
 * Один запрос к `POST /api/communicator`: читает UTF-8 стрим и на каждом чанке
 * накапливает буфер и вычисляет `parsed` (транскрипт из `[T]`, ответ после `[/T]`).
 */
export async function runCommunicatorStream(
  params: StreamChatRequest & {
    onChunk?: (chunk: CommunicatorStreamChunk) => void;
  },
): Promise<CommunicatorStreamChunk> {
  const { onChunk, ...req } = params;
  const body = await streamCommunicatorChat(req);
  let acc = "";
  await readTextStream(
    body,
    (text) => {
      acc += text;
      const parsed = parseTranscriptStream(acc);
      onChunk?.({ raw: acc, parsed });
    },
    req.signal,
  );
  const parsed = parseTranscriptStream(acc);
  return { raw: acc, parsed };
}
