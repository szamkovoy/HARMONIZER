import {
  sendDialogMessage,
  type DialogCompleteEvent,
  type OrchestratorDecision,
  type SendDialogMessageParams,
} from "@/services/communicator-client";

export type CommunicatorStreamChunk = {
  assistantText: string;
  decision: OrchestratorDecision | null;
  complete: DialogCompleteEvent | null;
};

export async function runCommunicatorStream(
  params: Omit<SendDialogMessageParams, "onChunk"> & {
    onChunk?: (chunk: CommunicatorStreamChunk) => void;
  },
): Promise<CommunicatorStreamChunk> {
  let assistantText = "";
  let decision: OrchestratorDecision | null = null;
  let complete: DialogCompleteEvent | null = null;
  const { onChunk, onOrchestratorDecision, onComplete, ...rest } = params;

  const result = await sendDialogMessage({
    ...rest,
    onOrchestratorDecision: (nextDecision) => {
      decision = nextDecision;
      onOrchestratorDecision?.(nextDecision);
      onChunk?.({ assistantText, decision, complete });
    },
    onChunk: (text) => {
      assistantText += text;
      onChunk?.({ assistantText, decision, complete });
    },
    onComplete: (event) => {
      complete = event;
      if (!assistantText && event.fullText) assistantText = event.fullText;
      onComplete?.(event);
      onChunk?.({ assistantText, decision, complete });
    },
  });

  return {
    assistantText: result.fullText || assistantText,
    decision: result.decision ?? decision,
    complete: result.complete ?? complete,
  };
}
