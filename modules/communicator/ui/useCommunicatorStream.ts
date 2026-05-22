import { useCallback, useMemo, useRef, useState } from "react";

import type { DialogCompleteEvent, OrchestratorDecision, SendDialogMessageParams } from "@/services/communicator-client";
import {
  runCommunicatorStream,
  type CommunicatorStreamChunk,
} from "@/modules/communicator/api/communicator-stream";

export type CommunicatorStreamStatus = "idle" | "thinking" | "typing";

export function useCommunicatorStream() {
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

  /** Align live stream display with sanitized `complete.fullText` before deferred commit reveal. */
  const syncDisplayText = useCallback((text: string) => {
    setAssistantText(text);
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
      const live = {
        assistantText: "",
        decision: null as OrchestratorDecision | null,
        complete: null as DialogCompleteEvent | null,
        modelUsed: undefined as string | undefined,
      };

      try {
        const result = await runCommunicatorStream({
          ...req,
          signal: ac.signal,
          onOrchestratorDecision: (nextDecision) => {
            live.decision = nextDecision;
            setDecision(nextDecision);
            req.onOrchestratorDecision?.(nextDecision);
          },
          onChunk: ({ assistantText: nextText, decision: nextDecision, complete: nextComplete, modelUsed: nextModel }) => {
            if (nextText || nextComplete?.fullText) setStatus("typing");
            live.assistantText = nextText;
            live.decision = nextDecision;
            live.complete = nextComplete;
            live.modelUsed = nextModel;
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
        const salvagedText = live.assistantText.trim() || live.complete?.fullText?.trim() || "";
        if (live.complete || salvagedText.length > 0) {
          const salvaged: CommunicatorStreamChunk = {
            assistantText: salvagedText,
            decision: live.decision,
            complete: live.complete,
            modelUsed: live.modelUsed ?? live.complete?.modelUsed,
          };
          setAssistantText(salvaged.assistantText);
          setDecision(salvaged.decision);
          setComplete(salvaged.complete);
          setModelUsed(salvaged.modelUsed);
          setStatus("idle");
          return salvaged;
        }
        const err = e instanceof Error ? e : new Error(String(e));
        reset();
        throw err;
      } finally {
        abortRef.current = null;
      }
    },
    [reset],
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
    syncDisplayText,
    isBusy,
  };
}
