import {
  readTextStream,
  streamCommunicatorChat,
  type StreamChatRequest,
} from "@/services/communicator-client";
import {
  parseTranscriptStream,
  type ParsedStreamParts,
} from "@/modules/communicator/core/transcript-parser";

export type CommunicatorStreamChunk = {
  raw: string;
  parsed: ParsedStreamParts;
};

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
