import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";

export function planningFinalizeArtifactsReady(params: {
  noGreeting: boolean;
  explicitMarkers: PlannedEventMarker[];
  salvagedVisibleMarkers: PlannedEventMarker[];
  hasDayFocusMarker: boolean;
  /** Greated-flow only: substantial day-focus salvaged from visible finalize (≥80 after scaffold strip). */
  hasSalvagedDayFocus?: boolean;
}): boolean {
  if (params.salvagedVisibleMarkers.length > 0) {
    return params.noGreeting || params.hasDayFocusMarker || Boolean(params.hasSalvagedDayFocus);
  }
  const explicitMarkersReady =
    params.explicitMarkers.length > 0
    && params.explicitMarkers.every((marker) => Boolean(marker.recommendation?.trim()));
  if (!explicitMarkersReady) return false;
  return params.noGreeting || params.hasDayFocusMarker || Boolean(params.hasSalvagedDayFocus);
}

export function buildPlanningFinalizeRepairInstruction(params: {
  baseInstruction: string;
  noGreeting: boolean;
}): string {
  const lines = [
    params.baseInstruction,
    "",
    "REPAIR THIS TURN ONLY. The user has explicitly finished planning, but your previous draft still behaved like gathering mode.",
    "Rewrite the same turn from scratch and FINALIZE it now.",
    "- Do NOT ask whether to add anything else.",
    "- Do NOT ask any follow-up question about planning.",
    "- Emit the final planning artifacts on this retry, not gathering artifacts.",
  ];
  if (params.noGreeting) {
    lines.push(
      "- This is the Day-tab ADD flow: emit one finalized [PLANNED_EVENT] per added action, each with recommendation and display_order.",
      "- Do NOT emit [CORRECT_RECOMMENDATION].",
      "- In visible text, confirm the added action(s) and include the recommendation for each one.",
    );
  } else {
    lines.push(
      "- Emit one finalized [PLANNED_EVENT] per action, each with recommendation and display_order.",
      "- Emit one [CORRECT_RECOMMENDATION: short_text=\"...\"] for the overall day focus.",
      "- In visible text, write the day-recommendation paragraph FIRST (no conversational ack like \"Хорошо, собираю план\" / \"Okay, putting the plan together\"), then each action with its recommendation, then the practice question.",
      "- short_text and the visible day-recommendation paragraph MUST be the same text, with no gathering scaffolding.",
    );
  }
  return lines.join("\n");
}

/** Last-resort rewrite when visible text still contains protocol markup after sanitize. */
export function buildLeakedMarkupRepairInstruction(params: {
  baseInstruction: string;
}): string {
  return [
    params.baseInstruction,
    "",
    "REPAIR THIS TURN ONLY. Your previous draft leaked internal protocol markup into the user-visible text (XML/HTML tags such as <PLANNED_EVENT>, leftover attributes like display_order= / spheres=, or unstripped square-bracket markers).",
    "Rewrite the same turn from scratch.",
    "- Visible text must be natural language only. The user must never see tag names, XML, HTML, or protocol attributes.",
    "- Invisible markers, if this turn needs them, MUST use square brackets exactly as specified: [PLANNED_EVENT: ...], [CORRECT_RECOMMENDATION: ...], [SUMMARIZE_EVENT: ...], [PRACTICE_PICK: ...]. Never emit XML/HTML tags.",
    "- Keep the same language, meaning, and branch job. Do not restart gathering, do not ask extra follow-up questions, and do not drop required finalize artifacts.",
  ].join("\n");
}
