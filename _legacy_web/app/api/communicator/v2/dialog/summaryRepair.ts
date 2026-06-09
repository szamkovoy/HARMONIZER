import type { DialogBranch } from "@legacy/app/api/_utils/dialogBranching";
import { samePlannedEventIdentity } from "@legacy/app/api/_utils/plannedEventInference";
import type { PlannedEventRow } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";

const SUMMARY_OUTCOME_CUE_RE = /(?:^|[\s,.;:!?()])(?:да|нет|удалось|не\s+удалось|получилось|не\s+получилось|лег(?:ла|ли)?|л[её]г(?:ла|ли)?|выспал(?:ся|ась|ись)|прош[её]л(?:о|а|и)?|справил(?:ся|ась|ись)|вышло|не\s+вышло|хорошо|плохо|замечательно|непрост|конфликт|договорил(?:ись|ся)|компромисс|сотрудничеств|спокойно|напряж[её]н|тревож|уверенн|собран|раздраж|радост|легко|тяжело|по-старому|привычно)(?=$|[\s,.;:!?()])/i;
const PRACTICE_SELECTION_RE = /(?:давай|выбер|сократ|увелич|замен|оставим|минут|медитац|дыхани|асан|йог|практик)/i;
const SUMMARY_NON_OCCURRED_RE = /(?:^|[\s,.;:!?()])(?:нет|не\s+удалось|не\s+получилось|не\s+вышло|не\s+успел(?:а|и)?|не\s+состоял(?:ось|ась|ись)|не\s+случил(?:ось|ась|ись)|сорвал(?:ось|ся|ась)|отменил(?:ось|ся|ась)|не\s+до\s+того)(?=$|[\s,.;:!?()])/i;
const SUMMARY_STATE_CUE_RE = /(?:^|[\s,.;:!?()])(?:спокойн[\p{L}-]*|тревож[\p{L}-]*|напряж[\p{L}-]*|раздраж[\p{L}-]*|радост[\p{L}-]*|обид[\p{L}-]*|зл[\p{L}-]*|нерв[\p{L}-]*|уверенн[\p{L}-]*|собран[\p{L}-]*|растерян[\p{L}-]*|вдохнов[\p{L}-]*|воодушев[\p{L}-]*|удовлетвор[\p{L}-]*|вымот[\p{L}-]*|устал[\p{L}-]*|легко|тяжело|с\s+интересом|с\s+радостью|с\s+удовольствием|с\s+облегчением|с\s+опаской|с\s+сомнением|с\s+напряжением|по-старому|привычно)(?=$|[\s,.;:!?()])/iu;

function userMessageHasSummaryCue(userMessage: string): boolean {
  const text = userMessage.trim().toLowerCase();
  if (!text) return false;
  return SUMMARY_OUTCOME_CUE_RE.test(text);
}

function looksLikePracticeSelection(userMessage: string): boolean {
  return PRACTICE_SELECTION_RE.test(userMessage.trim().toLowerCase());
}

export type DueEventSummaryAssessment =
  | "unknown"
  | "not_occurred"
  | "occurred_without_state"
  | "occurred_with_state";

export function assessDueEventSummary(userMessage: string): DueEventSummaryAssessment {
  const text = userMessage.trim().toLowerCase();
  if (!text || !userMessageHasSummaryCue(text)) return "unknown";
  if (SUMMARY_NON_OCCURRED_RE.test(text)) return "not_occurred";
  if (SUMMARY_STATE_CUE_RE.test(text)) return "occurred_with_state";
  return "occurred_without_state";
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
  const assessment = assessDueEventSummary(params.userMessage);
  return (
    params.branches.includes("summarizing")
    && params.summarizeEventsCount === 0
    && assessment !== "occurred_without_state"
    && likelyAnsweredDueEventIds(params.userMessage, params.dueEvents).length > 0
  );
}
