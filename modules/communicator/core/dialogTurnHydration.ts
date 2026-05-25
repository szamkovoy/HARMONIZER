import { stripDialogScaffoldMarkdown } from "@/modules/communicator/core/dialogTextCleanup";
import type { DialogCompleteEvent, PracticePicked, RecommendationCorrected } from "@/services/communicator-client";

export type SessionAssistantTurnMeta = {
  turnMode?: string;
  modelTier?: "premium" | "standard";
  modelUsed?: string;
  iteration?: number;
  practicePicked?: PracticePicked;
  planningPersistence?: DialogCompleteEvent["planningPersistence"];
  relatedEventIds?: string[];
  skippedPlannedEvents?: unknown[];
  matrixCells?: unknown[];
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

function normalizeHydrationComparableText(text: string): string {
  return stripDialogScaffoldMarkdown(text)
    .replace(/\(\s*[^)\n]*\bhint\b[^)\n]*\)/gi, "")
    .replace(/^\s*\*\s*Call\s*$/gim, "")
    .replace(/\(\s*(?:[A-Za-z][A-Za-z'’.,!?;:/-]*\s+){2,}[A-Za-z][A-Za-z'’.,!?;:/-]*\s*\)/g, "")
    .replace(/\n\n,\s*/g, "\n\n")
    .replace(/[ \t]+,/g, ",")
    .replace(/[ \t]+([?.!])/g, "$1")
    .replace(/([?.!])[ \t]*,/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
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
  if (currentText === sessionText) return true;

  const normalizedCurrent = normalizeHydrationComparableText(currentText);
  const normalizedSession = normalizeHydrationComparableText(sessionText);

  if (!normalizedCurrent || !normalizedSession) return false;
  return normalizedCurrent === normalizedSession;
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
    planningPersistence: complete.planningPersistence ?? params.sessionMeta?.planningPersistence,
    relatedEventIds: complete.relatedEventIds ?? params.sessionMeta?.relatedEventIds,
    skippedPlannedEvents: complete.skippedPlannedEvents ?? params.sessionMeta?.skippedPlannedEvents,
    matrixCells: complete.matrixCells ?? params.sessionMeta?.matrixCells,
    recommendationCorrected: complete.recommendationCorrected ?? params.sessionMeta?.recommendationCorrected,
    debugExport: complete.debugExport ?? params.sessionMeta?.debug,
  };
}
