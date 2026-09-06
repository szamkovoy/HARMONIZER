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

/**
 * Hidden retry when the assistant already asked add-more/assemble, but the draft
 * kept gathering without a new action marker. The model must classify the user's
 * reply by meaning — no phrase list.
 */
export function buildPlanningClosureInterpretRepairInstruction(params: {
  baseInstruction: string;
  noGreeting: boolean;
  alreadyClarified?: boolean;
}): string {
  const lines = [
    params.baseInstruction,
    "",
    "REPAIR THIS TURN ONLY. Your previous message asked whether to add more or to assemble the plan. The user's reply must be read BY MEANING in whatever language they used — do not look for fixed phrases.",
  ];
  if (params.alreadyClarified) {
    lines.push(
      "- You already asked a clarifier. If they named a new concrete action, emit [PLANNED_EVENT]. Otherwise FINALIZE now. Do not ask again.",
    );
  } else {
    lines.push(
      "- If they named a new concrete action for today, emit [PLANNED_EVENT] for it.",
      "- If they are done / wrapping up / do not want to add more, FINALIZE now.",
      "- If you cannot tell which, ask ONE short question in that same frame (another action for today, or assemble the plan?). Do not repeat your previous question verbatim. Do not invent an action. Do not FINALIZE yet.",
    );
  }
  if (params.noGreeting) {
    lines.push("- This is the Day-tab ADD flow: on finalize emit [PLANNED_EVENT] only, no [CORRECT_RECOMMENDATION].");
  } else {
    lines.push("- On finalize emit [PLANNED_EVENT] for each action and [CORRECT_RECOMMENDATION] for the day focus.");
  }
  return lines.join("\n");
}

/**
 * Hidden retry when the practice branch is still asking whether the user wants
 * a practice. Classify the last user message by meaning.
 */
export function buildPracticeDeclineInterpretRepairInstruction(params: {
  baseInstruction: string;
  alreadyClarified?: boolean;
}): string {
  const lines = [
    params.baseInstruction,
    "",
    "REPAIR THIS TURN ONLY. Read the user's last message BY MEANING in whatever language they used — do not look for fixed phrases.",
  ];
  if (params.alreadyClarified) {
    lines.push(
      "- You already asked once. If they named a practice, pick with [PRACTICE_PICK]. Otherwise write a short kind close with NO question and emit [PRACTICE_DECLINED].",
    );
  } else {
    lines.push(
      "- If they want a practice now, pick with [PRACTICE_PICK] or ask ONLY kind and/or duration.",
      "- If they do not want a practice now, write a short kind close with NO question and emit [PRACTICE_DECLINED].",
      "- If you cannot tell, ask ONE short question in that same frame (kind and duration, or skip today). Do not repeat the previous offer verbatim.",
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

/**
 * Repair instruction for the case where the model produced NO user-visible
 * text after sanitization — i.e. the draft contained only protocol markers
 * (or whitespace), so the assistant bubble would be empty. Model-agnostic
 * wording so it works for both the primary model and `AI_MODEL_FALLBACK`.
 */
export function buildEmptyContentRepairInstruction(params: {
  baseInstruction: string;
}): string {
  return [
    params.baseInstruction,
    "",
    "REPAIR THIS TURN ONLY. Your previous draft produced NO user-visible text — it contained only protocol markers (or whitespace), so there was nothing for the user to read.",
    "Rewrite the same turn from scratch and write a natural, human reply that continues the conversation.",
    "- Visible text must be natural language only. The user must never see tag names, XML, HTML, or protocol attributes.",
    "- Invisible markers, if this turn needs them, MUST use square brackets exactly as specified: [PLANNED_EVENT: ...], [CORRECT_RECOMMENDATION: ...], [SUMMARIZE_EVENT: ...], [PRACTICE_PICK: ...]. Never emit XML/HTML tags.",
    "- Keep the same language, meaning, and branch job. Do not restart gathering, do not ask extra follow-up questions, and do not drop required finalize artifacts.",
    "- If this turn is a final (planning finalize / summarizing final / practice pick), still emit the required invisible markers AND a complete visible reply.",
  ].join("\n");
}
