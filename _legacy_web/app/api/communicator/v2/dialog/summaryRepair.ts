import type { DialogBranch } from "@legacy/app/api/_utils/dialogBranching";
import type { PlannedEventRow } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";

function userMessageLikelyAnswersSingleDueEvent(userMessage: string, dueEvents: PlannedEventRow[]): boolean {
  if (dueEvents.length !== 1) return false;
  const text = userMessage.trim().toLowerCase();
  if (!text) return false;
  return /(?:^|[\s,.;:!?()])(?:да|нет|удалось|не\s+удалось|получилось|не\s+получилось|лег(?:ла|ли)?|л[её]г(?:ла|ли)?|выспал(?:ся|ась|ись)|прош[её]л(?:о|а|и)?|справил(?:ся|ась|ись)|вышло|не\s+вышло|хорошо|плохо|замечательно|непрост|конфликт|договорил(?:ись|ся)|компромисс|сотрудничеств)(?=$|[\s,.;:!?()])/i.test(text);
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
    && userMessageLikelyAnswersSingleDueEvent(params.userMessage, params.dueEvents)
  );
}
