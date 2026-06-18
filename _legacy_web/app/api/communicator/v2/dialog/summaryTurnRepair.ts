import {
  assistantVisibleContainsSummaryClarifyingCue,
  summaryVisibleTextMixesMultipleEvents,
} from "@legacy/app/api/communicator/v2/dialog/dialogTurnGuards";

export type SummaryRepairMode = "clarify_current_only" | "close_and_ask_next";

export function classifySummaryRepairMode(params: {
  visibleText: string;
  currentEventDescription: string;
  nextEventDescription?: string | null;
  hasSummaryMarker: boolean;
}): SummaryRepairMode | null {
  if (!summaryVisibleTextMixesMultipleEvents(
    params.visibleText,
    params.currentEventDescription,
    params.nextEventDescription,
  )) {
    return null;
  }
  if (assistantVisibleContainsSummaryClarifyingCue(params.visibleText) || !params.hasSummaryMarker) {
    return "clarify_current_only";
  }
  return "close_and_ask_next";
}

export function buildSummaryRepairInstruction(params: {
  baseInstruction: string;
  mode: SummaryRepairMode;
  currentEventDescription: string;
  nextEventDescription?: string | null;
}): string {
  const lines = [params.baseInstruction, "", "REPAIR THIS TURN ONLY. Rewrite the same turn from scratch and obey these rules strictly:"];
  if (params.mode === "clarify_current_only") {
    lines.push(
      `- Keep the CURRENT event open: "${params.currentEventDescription}".`,
      "- Emit NO [SUMMARIZE_EVENT] marker in this retry.",
      "- Write exactly ONE clarifying question about the current event only.",
      `- Do NOT mention or ask about the next event at all: "${params.nextEventDescription ?? ""}".`,
      "- No bridge, no second question, no extra recap.",
    );
  } else {
    lines.push(
      `- Close ONLY the current event: "${params.currentEventDescription}".`,
      "- Keep the [SUMMARIZE_EVENT] marker for the current event.",
      "- Do NOT ask any question about the closed/current event.",
      `- After the marker, write ONLY one short neutral bridge and exactly ONE question about the next event: "${params.nextEventDescription ?? ""}".`,
      "- No second question, no extra recap, no mention of any other event.",
    );
  }
  return lines.join("\n");
}

export function buildSummaryCloseRepairInstruction(params: {
  baseInstruction: string;
  currentEventDescription: string;
  nextEventDescription?: string | null;
}): string {
  const lines = [
    params.baseInstruction,
    "",
    "REPAIR THIS TURN ONLY. The user's reply already gave enough lived-state detail, so you must CLOSE the current event now.",
    `- Close ONLY the current event: "${params.currentEventDescription}".`,
    "- Emit the [SUMMARIZE_EVENT] marker for the current event on this retry.",
    "- Do NOT ask any clarifying question about the current event.",
  ];
  if (params.nextEventDescription?.trim()) {
    lines.push(
      `- After closing the current event, ask exactly ONE short question about the next event: "${params.nextEventDescription}".`,
      "- Do NOT ask two questions and do NOT mention any third event.",
    );
  } else {
    lines.push(
      "- This is the last event in summarizing: after the marker, write the branch-final reflection only.",
      "- Do NOT ask any further question about the closed event.",
    );
  }
  return lines.join("\n");
}
