import { DateTime } from "luxon";

import { getBothMaxDialogLength, getPlanningMaxDialogLength, getSummarizingMaxDialogLength } from "./dialogConfig";

export type PhaseTime = "morning" | "day" | "evening";
export type DialogBranch = "summarizing" | "planning";

export interface DueEventSummary {
  id: string;
  description: string;
  expected_at: string;
}

export function phaseTimeFor(nowLocal: DateTime): PhaseTime {
  const hour = nowLocal.hour;
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "day";
  return "evening";
}

export function chooseDialogBranches(params: {
  phaseTime: PhaseTime;
  dueEventsCount: number;
  userMessage: string;
  hoursSinceLastPlanning: number | null;
  planTomorrowMarker: boolean;
}): DialogBranch[] {
  const branches: DialogBranch[] = [];

  if (params.dueEventsCount > 0) {
    branches.push("summarizing");
  }

  const plannedRecently = params.hoursSinceLastPlanning != null && params.hoursSinceLastPlanning < 4;
  if (params.phaseTime === "morning" || params.phaseTime === "day") {
    if (!(plannedRecently && params.dueEventsCount === 0)) {
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
