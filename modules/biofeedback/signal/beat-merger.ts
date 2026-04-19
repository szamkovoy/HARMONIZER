/**
 * Слияние и дедупликация ударов.
 *
 * Извлечено из `modules/biofeedback/core/finger-analysis.ts` (`mergeBeatTimestampsPhase1`)
 * и `modules/breath/core/coherence-session-analysis.ts` (`dedupeBeatTimestampsMs`).
 *
 * Цель: дать единое поведение мерджа merged-ленте ударов, на которое опираются и engines,
 * и UI-слой Breath. Допуск дедупа — `BEAT_DUPLICATE_TOLERANCE_MS` (220 ms).
 */

import {
  BEAT_DUPLICATE_TOLERANCE_MS,
  BEAT_HISTORY_WINDOW_MS,
} from "@/modules/biofeedback/constants";

/**
 * Слияние новой партии ударов с уже накопленной merged-лентой.
 *
 * Стабильный префикс (события старше окна повторного анализа за вычетом допуска) сохраняется
 * как есть; новые удары добавляются в конец, при этом близкие к последнему — заменяют его
 * (а не добавляются вторым кандидатом).
 */
export function mergeBeatTimestampsPhase1(
  previous: readonly number[],
  next: readonly number[],
  reanalysisStartTimestampMs: number,
): number[] {
  const stablePrefix = previous.filter(
    (timestampMs) => timestampMs < reanalysisStartTimestampMs - BEAT_DUPLICATE_TOLERANCE_MS,
  );
  const merged: number[] = [...stablePrefix];

  for (const timestampMs of next) {
    const last = merged[merged.length - 1];
    if (last == null || timestampMs - last > BEAT_DUPLICATE_TOLERANCE_MS) {
      merged.push(timestampMs);
    } else if (Math.abs(timestampMs - last) <= BEAT_DUPLICATE_TOLERANCE_MS) {
      merged[merged.length - 1] = timestampMs;
    }
  }
  return merged;
}

/** Обрезка merged-ленты по `BEAT_HISTORY_WINDOW_MS` (45 минут): иначе HRV «плывёт». */
export function trimBeatHistory(
  merged: readonly number[],
  nowTimestampMs: number,
): number[] {
  const cutoff = nowTimestampMs - BEAT_HISTORY_WINDOW_MS;
  const out: number[] = [];
  for (const t of merged) {
    if (t >= cutoff) {
      out.push(t);
    }
  }
  return out;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Пост-очистка уже смёрженного глобального ряда:
 * если один реальный RR расколот на `короткий + длинный`, убираем внутренний beat.
 *
 * Важно: это делается ПОСЛЕ merge, а не только внутри одного окна peak detector.
 * Именно здесь видно артефакты, которые пережили повторный анализ соседних окон и
 * дожили до глобального merged-списка, на который потом опираются coherence / HRV / stress.
 */
export function collapseSplitMergedBeats(
  merged: readonly number[],
): { beats: number[]; removedCount: number } {
  if (merged.length < 3) {
    return { beats: [...merged], removedCount: 0 };
  }
  const out = [...merged];
  let removedCount = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i += 1) {
      const recentIntervals: number[] = [];
      for (let k = Math.max(1, i - 8); k < i; k += 1) {
        const rr = out[k]! - out[k - 1]!;
        if (rr >= 500 && rr <= 1_500) {
          recentIntervals.push(rr);
        }
      }
      if (recentIntervals.length === 0) {
        continue;
      }
      const medianRr = median(recentIntervals);
      const rrShort = out[i]! - out[i - 1]!;
      const rrLong = out[i + 1]! - out[i]!;
      const shortEnough = rrShort < medianRr * 0.72;
      const pairMatchesNormal =
        Math.abs(rrShort + rrLong - medianRr) <= Math.max(140, medianRr * 0.22);
      if (medianRr > 0 && shortEnough && pairMatchesNormal) {
        out.splice(i, 1);
        removedCount += 1;
        changed = true;
        break;
      }
    }
  }
  return { beats: out, removedCount };
}

/**
 * Жадная дедупликация по допуску (близкие метки — оставляем только первую).
 * Используется как при анализе сессии когерентности (на полном ряду за сессию),
 * так и в Breath UI при накоплении merged-снимков из снимков анализатора.
 */
export function dedupeBeatTimestampsMs(
  values: readonly number[],
  toleranceMs: number = BEAT_DUPLICATE_TOLERANCE_MS,
): number[] {
  if (values.length === 0) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]! - out[out.length - 1]! > toleranceMs) {
      out.push(sorted[i]!);
    }
  }
  return out;
}

/**
 * Сопоставляет удары по времени с предыдущим кадром.
 *
 * Зачем: после обрезки истории и переанализа пиков длины массивов расходятся; нельзя
 * сопоставлять по индексам — иначе при `holding` все удары ошибочно помечались
 * неэкстраполированными/невалидными и счётчик HRV «плавал». Используем ближайшую метку
 * в пределах `BEAT_DUPLICATE_TOLERANCE_MS`.
 *
 * `defaultEligible` — что назначить новому удару, у которого не нашлось соседа в prev
 * (как правило: tracking → true, иначе false).
 */
export function syncEligibilityByNearestTime(
  merged: readonly number[],
  prevBeats: readonly number[],
  prevEligible: readonly boolean[],
  defaultEligible: boolean,
): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < merged.length; i += 1) {
    const ts = merged[i]!;
    let bestJ = -1;
    let bestDist = Infinity;
    for (let j = 0; j < prevBeats.length; j += 1) {
      const d = Math.abs(ts - prevBeats[j]!);
      if (d < bestDist) {
        bestDist = d;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestDist <= BEAT_DUPLICATE_TOLERANCE_MS) {
      out[i] = prevEligible[bestJ] ?? false;
    } else {
      out[i] = defaultEligible;
    }
  }
  return out;
}
