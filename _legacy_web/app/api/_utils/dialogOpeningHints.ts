import type { DialogBranch, PhaseTime } from "@legacy/app/api/_utils/dialogBranching";

/** Branch- and phase-aware hint injected into orchestrator `opening` (not the system prompt). */
export function openingDayQuestionForContext(phaseTime: PhaseTime, branches: DialogBranch[]): string {
  const hasPlanning = branches.includes("planning");
  const hasSummarizing = branches.includes("summarizing");

  if (hasSummarizing && !hasPlanning) {
    return "Спроси коротко, как прошёл день: что было главным, что пережили, что осталось незавершённым.";
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
  if (hasSummarizing && hasPlanning) {
    return "Коротко спроси про уже случившееся сегодня и про ближайшие планы — по одному живому вопросу, без длинного списка.";
  }
  return "Спроси, что у пользователя сегодня происходит — что волнует, какие планы, что важного.";
}
