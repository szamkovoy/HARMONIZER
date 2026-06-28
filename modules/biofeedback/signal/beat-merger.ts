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

function collectRecentPhysioRr(
  beats: readonly number[],
  endExclusive: number,
  maxCount: number = 8,
): number[] {
  const out: number[] = [];
  for (let i = Math.max(1, endExclusive - maxCount); i < endExclusive; i += 1) {
    const rr = beats[i]! - beats[i - 1]!;
    if (rr >= 500 && rr <= 1_500) {
      out.push(rr);
    }
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
 * Восстанавливает очевидно пропущенные удары в finger-цепочке, если один длинный RR
 * близок к 2-3 локальным нормальным RR. Это нужно именно для PPG: при шуме/просадке
 * яркости один систолический пик может не детектироваться, и тогда RMSSD/стресс/кохерентность
 * считают одну «дыру» вместо 2-3 физиологических интервалов.
 *
 * Алгоритм консервативный:
 *  - смотрим только на интервалы существенно длиннее локальной медианы;
 *  - вставляем 1-2 synthetic beat'а, только если `gap / N` хорошо попадает в локальный RR;
 *  - никогда не трогаем короткие/обычные интервалы и не выходим за 3 сегмента.
 */
export function repairMissedMergedBeats(
  merged: readonly number[],
): { beats: number[]; insertedCount: number } {
  if (merged.length < 2) {
    return { beats: [...merged], insertedCount: 0 };
  }

  const out: number[] = [merged[0]!];
  let insertedCount = 0;

  for (let i = 1; i < merged.length; i += 1) {
    const next = merged[i]!;
    const prev = out[out.length - 1]!;
    const gap = next - prev;
    const recentIntervals = collectRecentPhysioRr(out, out.length);
    const medianRr = median(recentIntervals);

    if (medianRr > 0 && gap > medianRr * 1.55 && gap < medianRr * 3.4) {
      const segmentCount = Math.round(gap / medianRr);
      if (segmentCount >= 2 && segmentCount <= 3) {
        const segmentRr = gap / segmentCount;
        const matchesLocalRhythm =
          Math.abs(segmentRr - medianRr) <= Math.max(70, medianRr * 0.18);
        if (matchesLocalRhythm) {
          for (let step = 1; step < segmentCount; step += 1) {
            out.push(prev + segmentRr * step);
            insertedCount += 1;
          }
        }
      }
    }

    out.push(next);
  }

  return { beats: out, insertedCount };
}

/**
 * Подавляет характерный для PPG alternating jitter: два соседних RR уходят в разные
 * стороны (`короткий/длинный` или `длинный/короткий`), но их средний период хорошо
 * совпадает с локальным ритмом. В таком случае двигаем внутреннюю метку удара на
 * ограниченную величину, сохраняя сумму пары и не ломая медленную дыхательную волну.
 */
export function stabilizeAlternatingJitterBeats(
  merged: readonly number[],
): { beats: number[]; adjustedCount: number } {
  if (merged.length < 3) {
    return { beats: [...merged], adjustedCount: 0 };
  }

  const out = [...merged];
  let adjustedCount = 0;

  for (let i = 1; i < out.length - 1; i += 1) {
    const recentIntervals = collectRecentPhysioRr(out, i);
    const medianRr = median(recentIntervals);
    if (medianRr <= 0) {
      continue;
    }

    const rrLeft = out[i]! - out[i - 1]!;
    const rrRight = out[i + 1]! - out[i]!;
    if (!(rrLeft >= 500 && rrLeft <= 1_500 && rrRight >= 500 && rrRight <= 1_500)) {
      continue;
    }

    const leftDeviation = rrLeft - medianRr;
    const rightDeviation = rrRight - medianRr;
    const oppositeSides = leftDeviation * rightDeviation < 0;
    if (!oppositeSides) {
      continue;
    }

    const pairMean = (rrLeft + rrRight) / 2;
    const pairMatchesRhythm =
      Math.abs(pairMean - medianRr) <= Math.max(35, medianRr * 0.06);
    if (!pairMatchesRhythm) {
      continue;
    }

    const imbalance = Math.abs(rrLeft - rrRight);
    if (imbalance < Math.max(50, medianRr * 0.08)) {
      continue;
    }

    const shiftMs = clamp(((rrRight - rrLeft) / 2) * 0.6, -35, 35);
    if (Math.abs(shiftMs) < 1) {
      continue;
    }

    out[i] = out[i]! + shiftMs;
    adjustedCount += 1;
  }

  return { beats: out, adjustedCount };
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
/**
 * O(N) two-pointer синхронизация eligibility: для каждой записи в `merged` находит
 * ближайшую по времени запись в `prevBeats` и, если расстояние ≤ допуска дедупликации,
 * переносит с неё `eligibility`; иначе ставит `defaultEligible`.
 *
 * Обе последовательности отсортированы по возрастанию времени (инвариант beat-merger),
 * поэтому достаточно одного прохода с двумя указателями. Раньше здесь был честный
 * O(N·M) двойной цикл, который при N ≈ 3000 и частоте вызова 30 Hz (каждый optical
 * sample) выдавал ~540 миллионов сравнений в секунду — отсюда ощутимый нагрев CPU и
 * деградация FPS мандалы к концу длинной практики.
 */
export function syncEligibilityByNearestTime(
  merged: readonly number[],
  prevBeats: readonly number[],
  prevEligible: readonly boolean[],
  defaultEligible: boolean,
): boolean[] {
  const out: boolean[] = new Array(merged.length);
  const tol = BEAT_DUPLICATE_TOLERANCE_MS;
  let j = 0;
  for (let i = 0; i < merged.length; i += 1) {
    const ts = merged[i]!;
    // Продвигаем j, пока следующий prevBeat ближе к ts.
    while (j + 1 < prevBeats.length && Math.abs(prevBeats[j + 1]! - ts) <= Math.abs(prevBeats[j]! - ts)) {
      j += 1;
    }
    const bestDist = prevBeats.length > 0 ? Math.abs(prevBeats[j]! - ts) : Infinity;
    if (prevBeats.length > 0 && bestDist <= tol) {
      out[i] = prevEligible[j] ?? false;
    } else {
      out[i] = defaultEligible;
    }
  }
  return out;
}
