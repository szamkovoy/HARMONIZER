import type { DialogBranch, PhaseTime } from "@legacy/app/api/_utils/dialogBranching";

/** Branch- and phase-aware hint injected into orchestrator `opening` (not the system prompt). */
export function openingDayQuestionForContext(phaseTime: PhaseTime, branches: DialogBranch[]): string {
  const hasPlanning = branches.includes("planning");
  const hasSummarizing = branches.includes("summarizing");

  if (hasSummarizing && hasPlanning) {
    return "Коротко спроси сначала про событие, которое пора подытожить, а затем про ближайшие планы — без длинного списка и без абстрактного вопроса «как день».";
  }
  if (hasSummarizing && !hasPlanning) {
    return "Спроси коротко про то событие, которое сейчас пора подытожить: как оно прошло, в каком состоянии человек его прожил и что осталось незавершённым.";
  }
  if (hasPlanning && phaseTime === "morning") {
    return "Спроси конкретно про планы на сегодня: что на уме, какие планы, что требует решения или внимания. Не ограничивайся абстрактным «как настроение» — нужны планы и дела дня.";
  }
  if (hasPlanning && phaseTime === "day") {
    return "Спроси, что осталось на сегодня: планы, встречи, что важно довести до конца или решить.";
  }
  if (hasPlanning && phaseTime === "evening") {
    return "Спроси про планы на завтра — что намечено, что важно не отложить.";
  }
  return "Спроси, что у пользователя сегодня происходит — что волнует, какие планы, что важного.";
}
