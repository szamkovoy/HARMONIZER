import type { DialogBranch, PhaseTime } from "@legacy/app/api/_utils/dialogBranching";

/** Branch- and phase-aware hint injected into orchestrator `opening` (not the system prompt). */
export function openingDayQuestionForContext(phaseTime: PhaseTime, branches: DialogBranch[]): string {
  const hasPlanning = branches.includes("planning");
  const hasSummarizing = branches.includes("summarizing");

  if (hasSummarizing && hasPlanning) {
    return "Коротко спроси сначала про событие, которое пора подытожить: что произошло и в каком состоянии человек его проживал. Затем спроси про 1-3 самых важных ближайших события — без длинного списка и без абстрактного вопроса «как день».";
  }
  if (hasSummarizing && !hasPlanning) {
    return "Спроси коротко про то событие, которое сейчас пора подытожить: что реально произошло, в каком состоянии человек его проживал и что осталось незавершённым.";
  }
  if (hasPlanning && phaseTime === "morning") {
    return "Спроси конкретно про 1-3 самых важных события на сегодня: что требует решения или внимания. Не ограничивайся абстрактным «как настроение» и не превращай вопрос в сбор всего расписания.";
  }
  if (hasPlanning && phaseTime === "day") {
    return "Спроси, что осталось самым важным на сегодня: какие 1-3 события, встречи или дела действительно важно довести до конца или решить.";
  }
  if (hasPlanning && phaseTime === "evening") {
    return "Спроси про 1-3 самых важных плана на завтра — что намечено и что важно не отложить.";
  }
  return "Спроси, что у пользователя сегодня происходит — что волнует, какие планы, что важного.";
}
