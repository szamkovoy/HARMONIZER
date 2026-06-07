import type { DialogBranch } from "@legacy/app/api/_utils/dialogBranching";
import { samePlannedEventIdentity } from "@legacy/app/api/_utils/plannedEventInference";
import type { PlannedEventRow } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";

const SUMMARY_OUTCOME_CUE_RE = /(?:^|[\s,.;:!?()])(?:да|нет|удалось|не\s+удалось|получилось|не\s+получилось|лег(?:ла|ли)?|л[её]г(?:ла|ли)?|выспал(?:ся|ась|ись)|прош[её]л(?:о|а|и)?|справил(?:ся|ась|ись)|вышло|не\s+вышло|хорошо|плохо|замечательно|непрост|конфликт|договорил(?:ись|ся)|компромисс|сотрудничеств|спокойно|напряж[её]н|тревож|уверенн|собран|раздраж|радост|легко|тяжело|по-старому|привычно)(?=$|[\s,.;:!?()])/i;
const PRACTICE_SELECTION_RE = /(?:давай|выбер|сократ|увелич|замен|оставим|минут|медитац|дыхани|асан|йог|практик)/i;

function userMessageHasSummaryCue(userMessage: string): boolean {
  const text = userMessage.trim().toLowerCase();
  if (!text) return false;
  return SUMMARY_OUTCOME_CUE_RE.test(text);
}

function looksLikePracticeSelection(userMessage: string): boolean {
  return PRACTICE_SELECTION_RE.test(userMessage.trim().toLowerCase());
}

export function likelyAnsweredDueEventIds(userMessage: string, dueEvents: PlannedEventRow[]): string[] {
  if (!userMessageHasSummaryCue(userMessage)) return [];
  const matchedIds = dueEvents
    .filter((event) => samePlannedEventIdentity(event.description, userMessage))
    .map((event) => event.id);
  if (matchedIds.length > 0) return matchedIds;
  if (dueEvents.length === 1 && !looksLikePracticeSelection(userMessage)) return [dueEvents[0]!.id];
  return [];
}

export function shouldRetryForMissingSummaryMarker(params: {
  branches: DialogBranch[];
  summarizeEventsCount: number;
  userMessage: string;
  dueEvents: PlannedEventRow[];
}): boolean {
  return (
    params.branches.includes("summarizing")
    && params.summarizeEventsCount === 0
    && likelyAnsweredDueEventIds(params.userMessage, params.dueEvents).length > 0
  );
}
