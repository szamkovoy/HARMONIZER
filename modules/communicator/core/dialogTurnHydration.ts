import type { DialogCompleteEvent, PracticePicked, RecommendationCorrected } from "@/services/communicator-client";

export type SessionAssistantTurnMeta = {
  turnMode?: string;
  modelTier?: "premium" | "standard";
  modelUsed?: string;
  iteration?: number;
  practicePicked?: PracticePicked;
  debug?: Record<string, unknown>;
  shouldClose?: boolean;
  recommendationCorrected?: RecommendationCorrected;
};

export function isFinalLikeTurnMode(turnMode: string | null | undefined): boolean {
  return turnMode === "final_recommendation"
    || turnMode === "final_recommendation_with_validation_warning"
    || turnMode === "forced_final"
    || turnMode === "fast_track_final";
}

export function needsAssistantTurnHydration(complete: DialogCompleteEvent | null | undefined): boolean {
  if (!complete) return true;
  if (!complete.turnMode || !complete.modelTier || !complete.modelUsed || complete.iteration == null) return true;
  if (isFinalLikeTurnMode(complete.turnMode) && !complete.practicePicked) return true;
  return false;
}

export function sessionAssistantMatchesTurn(params: {
  currentText: string;
  currentMessageId?: string;
  sessionText: string;
  sessionMessageId?: string;
}): boolean {
  const currentText = params.currentText.trim();
  const sessionText = params.sessionText.trim();

  if (!sessionText) return false;
  if (!currentText) return true;
  if (params.currentMessageId && params.sessionMessageId && params.currentMessageId === params.sessionMessageId) return true;
  return currentText === sessionText;
}

export function mergeCompleteWithSession(params: {
  complete: DialogCompleteEvent | null | undefined;
  sessionMeta: SessionAssistantTurnMeta | undefined;
  sessionText: string;
  sessionMessageId?: string;
}): DialogCompleteEvent {
  const complete = params.complete ?? {
    fullText: "",
    shouldClose: false,
  };

  return {
    ...complete,
    messageId: complete.messageId ?? params.sessionMessageId,
    fullText: complete.fullText?.trim() ? complete.fullText : params.sessionText,
    shouldClose: complete.shouldClose ?? params.sessionMeta?.shouldClose ?? false,
    turnMode: complete.turnMode ?? params.sessionMeta?.turnMode,
    modelTier: complete.modelTier ?? params.sessionMeta?.modelTier,
    modelUsed: complete.modelUsed ?? params.sessionMeta?.modelUsed,
    iteration: complete.iteration ?? params.sessionMeta?.iteration,
    practicePicked: complete.practicePicked ?? params.sessionMeta?.practicePicked,
    recommendationCorrected: complete.recommendationCorrected ?? params.sessionMeta?.recommendationCorrected,
    debugExport: complete.debugExport ?? params.sessionMeta?.debug,
  };
}
