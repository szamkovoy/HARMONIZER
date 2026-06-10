import { DateTime } from "luxon";

import { phaseTimeForHour } from "./dialogTimeOfDay";
import { getBothMaxDialogLength, getPlanningMaxDialogLength, getSummarizingMaxDialogLength } from "./dialogConfig";
import { forcedPhaseOrNull, hoursToMs } from "./testMode";

export type PhaseTime = "morning" | "day" | "evening";
export type DialogBranch = "summarizing" | "planning";

export interface DueEventSummary {
  id: string;
  description: string;
  expected_at: string;
}

export function phaseTimeFor(nowLocal: DateTime): PhaseTime {
  const forced = forcedPhaseOrNull();
  if (forced) return forced;

  return phaseTimeForHour(nowLocal.hour);
}

export function chooseDialogBranches(params: {
  phaseTime: PhaseTime;
  dueEventsCount: number;
  userMessage: string;
  hoursSinceLastPlanning: number | null;
  planTomorrowMarker: boolean;
  /** Opening turn of a new dialog: keep planning in morning/day even if anti-replan window is active. */
  forcePlanningOnOpening?: boolean;
}): DialogBranch[] {
  const branches: DialogBranch[] = [];

  if (params.dueEventsCount > 0) {
    branches.push("summarizing");
  }

  const planningAntireplanMs = hoursToMs(4);
  const plannedRecently =
    params.hoursSinceLastPlanning != null &&
    params.hoursSinceLastPlanning * 60 * 60 * 1000 < planningAntireplanMs;
  if (params.phaseTime === "morning" || params.phaseTime === "day") {
    if (params.forcePlanningOnOpening || !(plannedRecently && params.dueEventsCount === 0)) {
      branches.push("planning");
    }
    return branches;
  }

  if (params.planTomorrowMarker || /завтр/i.test(params.userMessage)) {
    branches.push("planning");
  }

  return branches;
}

export function effectiveDialogMax(branches: DialogBranch[]): number {
  const hasSummarizing = branches.includes("summarizing");
  const hasPlanning = branches.includes("planning");
  if (hasSummarizing && hasPlanning) return getBothMaxDialogLength();
  if (hasSummarizing) return getSummarizingMaxDialogLength();
  return getPlanningMaxDialogLength();
}
