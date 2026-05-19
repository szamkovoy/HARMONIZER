/**
 * Диапазоны длительности для карточки ассистента (дыхание / медитация).
 * Копия `modules/practices/core/assistantSelectableDurations.ts` для Vercel (_legacy_web-only deploy).
 */
export function selectableDurationMinutesForPracticeCard(kind: "breath" | "meditation" | "yoga"): number[] {
  if (kind === "meditation") return Array.from({ length: 10 }, (_, index) => index + 1);
  if (kind === "breath") return Array.from({ length: 16 }, (_, index) => index + 5);
  return [];
}

/** Порог (мин), выше которого расхождение marker vs история логируется как mismatch. */
export const PRACTICE_CARD_DURATION_MISMATCH_THRESHOLD_MIN = 2;

export function clipDurationMinutesToSelectableMinutes(
  minutes: number,
  selectable: readonly number[],
): { value: number; clipped: boolean } {
  if (!selectable.length || !Number.isFinite(minutes)) {
    return { value: minutes, clipped: false };
  }
  const rounded = Math.max(1, Math.round(minutes));
  if (selectable.includes(rounded)) {
    return { value: rounded, clipped: false };
  }
  let best = selectable[0]!;
  let bestDist = Math.abs(best - rounded);
  for (const m of selectable) {
    const d = Math.abs(m - rounded);
    if (d < bestDist || (d === bestDist && m < best)) {
      best = m;
      bestDist = d;
    }
  }
  return { value: best, clipped: true };
}
