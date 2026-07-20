export type ClosureHistoryMessage = {
  role: string;
  content?: string | null;
  transcript?: string | null;
};

export function normalizePlanningDoneText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[\s.!?,…:;-]+/u, "")
    .replace(/[àáâãäå]/g, "a")
    .replace(/æ/g, "ae")
    .replace(/ç/g, "c")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/ñ/g, "n")
    .replace(/[òóôõö]/g, "o")
    .replace(/œ/g, "oe")
    .replace(/[ùúûü]/g, "u")
    .replace(/[ýÿ]/g, "y")
    .replace(/ß/g, "ss");
}

function textFromClosureHistoryMessage(message: ClosureHistoryMessage): string {
  return String(message.content ?? message.transcript ?? "").trim();
}

export function lastAssistantTextFromHistory(history: ClosureHistoryMessage[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === "assistant") return textFromClosureHistoryMessage(message);
  }
  return "";
}

/** Assistant turn asked whether the user wants to add more to today's plan. */
export function assistantAskedToAddMoreToPlan(assistantText: string): boolean {
  const text = assistantText.trim();
  if (!text || !/[?？]/.test(text)) return false;
  return /(?:добав|ещ[её]|что-то\s+ещ[её]|anything\s+else|something\s+else|add\s+more|add\s+another|aggiung|qualcos['’]altro|altro\s+che|encore|noch\s+etwas|meer|m[aá]s|mais)/iu.test(
    text.toLowerCase(),
  );
}

const STRONG_PLANNING_CUE_RE =
  /(?:^|[\s,.;:!?()])(?:(?:хочу|планирую|планируется|собираюсь|соберусь|предстоит|намечен(?:о|а|ы)?|нужно|надо|пора)|хотел(?:\s+бы)?|хотела(?:\s+бы)?|погуляю|посмотрю|выберу|поеду|пойду|лягу|лечь|voglio|vorrei|andr[òo]|vado|devo|mi\s+aspetta|pianific|programma|obiettivo|goal|i\s+want|i['’]?ll|i\s+will|going\s+to)(?=$|[\s,.;:!?()])/i;

/**
 * Strip negated "want" phrases so bare `хочу` / `voglio` inside
 * "не хочу" / "don't want" cannot fake a planning cue.
 */
function stripNegatedWantCues(text: string): string {
  return text.replace(
    /(?:^|[\s,.;:!?()])(?:не\s+хочу|не\s+хотел(?:а|и)?(?:\s+бы)?|не\s+буду|don't\s+want|do\s+not\s+want|won'?t|non\s+voglio|je\s+ne\s+veux|no\s+quiero|n[aã]o\s+quero|ik\s+wil\s+geen)(?=$|[\s,.;:!?()])/giu,
    " ",
  );
}

/** Empty-plan / "nothing to plan today" refusals (any word order). */
function isEmptyPlanRefusal(text: string): boolean {
  const normalized = normalizePlanningDoneText(text);
  if (!normalized) return false;
  return /(?:ничего\s+(?:сегодня\s+)?(?:не\s+)?планир|планир\p{L}*\s+(?:сегодня\s+)?не\s+хоч|не\s+хоч\p{L}*\s+(?:сегодня\s+)?(?:ничего\s+)?планир|не\s+буду\s+планир|без\s+планов|планов\s+нет|ничего\s+на\s+сегодня|nothing\s+to\s+plan|don'?t\s+want\s+to\s+plan|do\s+not\s+want\s+to\s+plan|no\s+plans?(?:\s+for\s+today|\s+today)?|nichts\s+planen|rien\s+[àa]\s+planifier|niente\s+da\s+pianificare|nada\s+que\s+planificar|nada\s+a\s+planejar|niets\s+te\s+plannen)/iu.test(
    normalized,
  );
}

/** User is naming a concrete new action, not declining to add more. */
export function looksLikeNewPlannedAction(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Prefer a named action over a trailing «больше ничего» / "that's all" in the
  // same turn — otherwise "Хочу фильм. И больше ничего." is treated as empty-plan.
  if (STRONG_PLANNING_CUE_RE.test(stripNegatedWantCues(trimmed))) return true;
  if (isDeclineOfAddingMore(trimmed)) return false;
  return false;
}

const DECLINE_ADDING_MORE_RE =
  /(?:(?:^|[\s,.;:!?()])(?:non|no|not|n[oõ]o|don't|do not|won't|cannot|can't|нет|не)|(?:non\s+voglio|don't\s+want|je\s+ne\s+veux|no\s+quiero|n[aã]o\s+quero|не\s+хочу|nicht\s+mehr|ik\s+wil\s+geen))(?:\s+\w+){0,10}\s*(?:aggiung|add|ajout|hinzuf|toevoeg|a[nñ]ad|adicion|добав|больше|more|altro|niente|nothing|nulla|rien|nada|niets|nichts|mais|m[aá]s|encore)|(?:non\s+c\s*['’]?\s*e\s+pi[uú]\s+niente\s+da\s+aggiungere|niente\s+altro|nothing\s+else|nothing\s+more|that's\s+all|that\s+is\s+all|that's\s+enough|that\s+is\s+enough|basta|хватит|достаточно|больше\s+ничего|ничего\s+больше|plus\s+rien|meer\s+niet|niets\s+meer|nada\s+m[aá]s|nada\s+mais)/iu;

function isDeclineOfAddingMore(text: string): boolean {
  const normalized = normalizePlanningDoneText(text);
  if (!normalized) return false;
  if (/^(?:(?:нет|не|no|non|nope|nah|nono|no\s+no)|нет[,.\s]+(?:всё|все|спасибо)|не[,.\s]+всё|не[,.\s]+все)[.!?,…\s]*$/iu.test(normalized)) {
    return true;
  }
  if (isEmptyPlanRefusal(normalized)) return true;
  return DECLINE_ADDING_MORE_RE.test(normalized);
}

function minimalUnpromptedDone(text: string): boolean {
  const normalized = normalizePlanningDoneText(text);
  if (!normalized) return false;
  if (/^(?:достаточно|хватит|всё|все|это\s+вс[её]|basta|va\s+bene\s+cos[ìi]|questo\s+e\s+sufficiente|niente\s+pi[uú]|that's\s+all|that\s+is\s+all|that's\s+enough|that\s+is\s+enough|i(?:'m|\s+am)\s+done|niente\s+altro|nient'altro|niente\s+da\s+affrontare|nothing\s+else|nothing\s+more|plus\s+rien|niets\s+meer|nada\s+m[aá]s|nada\s+mais)[.!?,…\s]*$/iu.test(
    normalized,
  )) {
    return true;
  }
  if (normalized.split(/\s+/).length > 14) return false;
  return /(?:^|[\s,.;:!?()])(?:достаточно|хватит|questo\s+e\s+sufficiente|niente\s+da\s+affrontare|non\s+c\s*['’]?\s*e\s+pi[uú]\s+niente\s+da\s+aggiungere|that's\s+enough|plus\s+rien)(?=$|[\s,.;:!?()])/iu.test(
    normalized,
  );
}

function explicitPlanFinishProposal(text: string): boolean {
  const normalized = normalizePlanningDoneText(text);
  if (!normalized) return false;
  return /(?<![\p{L}\p{N}-])(?:possiamo\s+finire|chiud(?:iamo|ere)\s+qua|chiud(?:iamo|ere)\s+(?:qui|il\s+piano)|let'?s\s+finish|we\s+can\s+finish|we\s+can\s+wrap\s+up|on\s+peut\s+finir|podemos\s+terminar|wir\s+k[oö]nnen\s+abschlie[ßs]en)(?![\p{L}\p{N}-])/iu.test(
    normalized,
  );
}

function contextualFinishAfterCloseQuestion(text: string, history: ClosureHistoryMessage[]): boolean {
  const normalized = normalizePlanningDoneText(text);
  if (!normalized) return false;
  const assistantText = lastAssistantTextFromHistory(history);
  if (!assistantText || !/[?？]/.test(assistantText)) return false;
  const askedClosure =
    assistantAskedToAddMoreToPlan(assistantText)
    || /(?:хватит|достаточно|закры|заверш|собер(?:е|ё)м\s+план|finish|done|close|wrap\s+up|va\s+bene\s+cos[ìi]|chiud|finir|suffi|enough|terminer|clore|reicht|genug|cerrar|fechar)/iu.test(
      assistantText.toLowerCase(),
    );
  if (!askedClosure) return false;
  return /^(?:(?:да|ага|угу|yes|yeah|yep|sure|ok|okay|s[iì]|oui|ja|sim)[!.,\s]+)?(?:possiamo\s+finire|chiud(?:iamo|ere)\s+qua|chiud(?:iamo|ere)\s+(?:qui|il\s+piano)|va\s+bene\s+cos[ìi]|niente\s+pi[uú]|niente\s+altro|nient['’]altro|basta|that'?s\s+enough|let'?s\s+finish|we\s+can\s+finish|we\s+can\s+wrap\s+up|on\s+peut\s+finir|podemos\s+terminar|wir\s+k[oö]nnen\s+abschlie[ßs]en)[!.,\s]*$/iu.test(
    normalized,
  );
}

/**
 * A planning user turn that closes gathering — typically a negative answer to
 * "anything else to add?" — must never become a planned action.
 */
export function userDeclinesAddingMoreToPlan(userText: string, history: ClosureHistoryMessage[]): boolean {
  if (!userText.trim()) return false;
  if (looksLikeNewPlannedAction(userText)) return false;
  const assistantText = lastAssistantTextFromHistory(history);
  if (!assistantAskedToAddMoreToPlan(assistantText)) return false;
  return isDeclineOfAddingMore(userText);
}

/**
 * True when the user is done naming actions for this gathering turn.
 * Includes "named action + больше ничего" (finalize with that action) — inference
 * must still keep the action via {@link looksLikeNewPlannedAction}.
 */
export function isPlanningGatheringClosureTurn(userText: string, history: ClosureHistoryMessage[]): boolean {
  if (!userText.trim()) return false;
  if (looksLikeNewPlannedAction(userText)) {
    // Same turn: name an action and close gathering («… И больше ничего»).
    return isDeclineOfAddingMore(userText) || minimalUnpromptedDone(userText);
  }
  if (isDeclineOfAddingMore(userText)) return true;
  if (userDeclinesAddingMoreToPlan(userText, history)) return true;
  if (minimalUnpromptedDone(userText)) return true;
  if (explicitPlanFinishProposal(userText)) return true;
  if (contextualFinishAfterCloseQuestion(userText, history)) return true;
  return false;
}

/** Backward-compatible alias used by marker filters. */
export function standalonePlanningDoneMessage(text: string): boolean {
  return isPlanningGatheringClosureTurn(text, []);
}

export function isPlanningDoneLikeDescription(desc: string): boolean {
  return isDeclineOfAddingMore(desc) || minimalUnpromptedDone(desc);
}

export function segmentIsPlanningDoneClosure(text: string, history: ClosureHistoryMessage[] = []): boolean {
  return isPlanningGatheringClosureTurn(text, history);
}

/** Drop visible/model markers that merely echo the user's closure reply. */
export function markerEchoesUserClosureReply(markerDesc: string, closureUserMessage: string): boolean {
  if (!closureUserMessage.trim()) return false;
  const left = normalizePlanningDoneText(markerDesc);
  const right = normalizePlanningDoneText(closureUserMessage);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return isDeclineOfAddingMore(markerDesc) && isDeclineOfAddingMore(closureUserMessage);
}

export function filterClosureEchoPlanningMarkers<T extends { desc: string }>(
  markers: T[],
  closureUserMessage?: string | null,
): T[] {
  if (!closureUserMessage?.trim()) return markers;
  return markers.filter((marker) => !markerEchoesUserClosureReply(marker.desc, closureUserMessage));
}
