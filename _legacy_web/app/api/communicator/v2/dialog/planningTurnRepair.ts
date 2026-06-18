import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";

export function planningFinalizeArtifactsReady(params: {
  noGreeting: boolean;
  explicitMarkers: PlannedEventMarker[];
  salvagedVisibleMarkers: PlannedEventMarker[];
  hasDayFocusMarker: boolean;
}): boolean {
  if (params.salvagedVisibleMarkers.length > 0) return true;
  const explicitMarkersReady =
    params.explicitMarkers.length > 0
    && params.explicitMarkers.every((marker) => Boolean(marker.recommendation?.trim()));
  if (!explicitMarkersReady) return false;
  return params.noGreeting || params.hasDayFocusMarker;
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
      "- In visible text, write the final wrap-up, then each action with its recommendation, then the practice question.",
    );
  }
  return lines.join("\n");
}
