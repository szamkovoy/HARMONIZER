import { useCallback, useMemo, useRef, useState } from "react";

import type { DialogCompleteEvent, OrchestratorDecision, SendDialogMessageParams } from "@/services/communicator-client";
import { runCommunicatorStream } from "@/modules/communicator/api/communicator-stream";

export type CommunicatorStreamStatus = "idle" | "thinking" | "typing";

export function useCommunicatorStream(options?: { onError?: (err: Error) => void }) {
  const { onError } = options ?? {};
  const [assistantText, setAssistantText] = useState("");
  const [decision, setDecision] = useState<OrchestratorDecision | null>(null);
  const [complete, setComplete] = useState<DialogCompleteEvent | null>(null);
  const [modelUsed, setModelUsed] = useState<string | undefined>();
  const [status, setStatus] = useState<CommunicatorStreamStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const isBusy = useMemo(() => status === "thinking" || status === "typing", [status]);

  const reset = useCallback(() => {
    setAssistantText("");
    setDecision(null);
    setComplete(null);
    setModelUsed(undefined);
    setStatus("idle");
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(
    async (req: Omit<SendDialogMessageParams, "signal" | "onChunk">) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setStatus("thinking");
      setAssistantText("");
      setDecision(null);
      setComplete(null);
      setModelUsed(undefined);

      try {
        const result = await runCommunicatorStream({
          ...req,
          signal: ac.signal,
          onOrchestratorDecision: (nextDecision) => {
            setDecision(nextDecision);
            req.onOrchestratorDecision?.(nextDecision);
          },
          onChunk: ({ assistantText: nextText, decision: nextDecision, complete: nextComplete }) => {
            if (nextText || nextComplete?.fullText) setStatus("typing");
            setAssistantText(nextText);
            setDecision(nextDecision);
            setComplete(nextComplete);
            setModelUsed(nextComplete?.modelUsed);
          },
        });

        if (ac.signal.aborted) {
          reset();
          return null;
        }

        setAssistantText(result.assistantText);
        setDecision(result.decision);
        setComplete(result.complete);
        setModelUsed(result.modelUsed ?? result.complete?.modelUsed);
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
    assistantText,
    decision,
    complete,
    modelUsed,
    status,
    run,
    abort,
    reset,
    isBusy,
  };
}
