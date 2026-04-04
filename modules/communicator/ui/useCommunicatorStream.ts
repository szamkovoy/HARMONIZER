import { useCallback, useMemo, useRef, useState } from "react";

import type { StreamChatRequest } from "@/services/communicator-client";
import {
  parseTranscriptStream,
  type ParsedStreamParts,
} from "@/modules/communicator/core/transcript-parser";
import { runCommunicatorStream } from "@/modules/communicator/api/communicator-stream";

export type CommunicatorStreamStatus = "idle" | "processing" | "streaming";

export function useCommunicatorStream(options?: { onError?: (err: Error) => void }) {
  const { onError } = options ?? {};
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<CommunicatorStreamStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const parsed: ParsedStreamParts = useMemo(() => parseTranscriptStream(raw), [raw]);

  const reset = useCallback(() => {
    setRaw("");
    setStatus("idle");
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(
    async (req: Omit<StreamChatRequest, "signal">) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setStatus("processing");
      setRaw("");

      try {
        setStatus("streaming");
        const result = await runCommunicatorStream({
          ...req,
          signal: ac.signal,
          onChunk: ({ raw: next }) => {
            setRaw(next);
          },
        });

        if (ac.signal.aborted) {
          reset();
          return null;
        }

        setRaw(result.raw);
        setStatus("idle");
        return result;
      } catch (e: unknown) {
        const aborted =
          ac.signal.aborted ||
          (e instanceof Error && e.name === "AbortError") ||
          (typeof e === "object" &&
            e !== null &&
            "name" in e &&
            (e as { name: string }).name === "AbortError");
        if (aborted) {
          reset();
          return null;
        }
        const err = e instanceof Error ? e : new Error(String(e));
        onError?.(err);
        reset();
        throw err;
      } finally {
        abortRef.current = null;
      }
    },
    [onError, reset],
  );

  return {
    raw,
    parsed,
    status,
    run,
    abort,
    reset,
    isBusy: status === "processing" || status === "streaming",
  };
}
