import {
  TACHO_MAX_INTERBEAT_GAP_MS,
  TACHO_SAMPLE_RATE_HZ,
} from "@/modules/breath/core/coherence-constants";

export type RrBeatEvent = { timeMs: number; rrMs: number };

/**
 * Очистка RR: отклонение &gt;30% от медианы предыдущих в окне — замена на медиану.
 * Возвращает очищенные события и долю «плохих» в окне (для предупреждения).
 */
export function cleanRrSequence(
  events: readonly RrBeatEvent[],
  deviationRatio: number,
): { cleaned: RrBeatEvent[]; badFraction: number } {
  if (events.length === 0) {
    return { cleaned: [], badFraction: 0 };
  }

  const cleaned: RrBeatEvent[] = [];
  let badCount = 0;

  for (let i = 0; i < events.length; i += 1) {
    const prev = events.slice(Math.max(0, i - 9), i).map((e) => e.rrMs);
    const median =
      prev.length === 0 ? events[i].rrMs : medianSorted([...prev].sort((a, b) => a - b));
    let rr = events[i].rrMs;
    if (median > 0 && Math.abs(rr - median) / median > deviationRatio) {
      rr = median;
      badCount += 1;
    }
    cleaned.push({ timeMs: events[i].timeMs, rrMs: rr });
  }

  return {
    cleaned,
    badFraction: events.length > 0 ? badCount / events.length : 0,
  };
}

/**
 * Мягкая очистка для пранаямы: те же критерии отклонения 30 %, замена артефакта на средний RR
 * по «хорошим» интервалам (аналог среднего BPM по ряду). RMSSD/стресс используют {@link cleanRrSequence}.
 */
export function cleanRrSequenceCoherence(
  events: readonly RrBeatEvent[],
  deviationRatio: number,
): { cleaned: RrBeatEvent[]; badFraction: number } {
  if (events.length === 0) {
    return { cleaned: [], badFraction: 0 };
  }

  const isBad: boolean[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const prev = events.slice(Math.max(0, i - 9), i).map((e) => e.rrMs);
    const medianPrev =
      prev.length === 0 ? events[i]!.rrMs : medianSorted([...prev].sort((a, b) => a - b));
    const rr = events[i]!.rrMs;
    isBad.push(medianPrev > 0 && Math.abs(rr - medianPrev) / medianPrev > deviationRatio);
  }

  const goodRr = events
    .map((e, i) => (!isBad[i] ? e.rrMs : null))
    .filter((x): x is number => x != null);
  const meanRr =
    goodRr.length > 0
      ? goodRr.reduce((s, v) => s + v, 0) / goodRr.length
      : events.reduce((s, e) => s + e.rrMs, 0) / events.length;

  const cleaned = events.map((e, i) => ({
    timeMs: e.timeMs,
    rrMs: isBad[i] ? meanRr : e.rrMs,
  }));

  const badCount = isBad.filter(Boolean).length;
  return {
    cleaned,
    badFraction: events.length > 0 ? badCount / events.length : 0,
  };
}

function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Строит мгновенный BPM в точках между ударами и линейно **интерполирует** на сетку
 * sampleRate Гц на интервале [windowStartMs, windowEndMs].
 *
 * КЛЮЧЕВОЕ: НИКАКОЙ экстраполяции за пределы реальных ударов. Если точка сетки лежит вне
 * диапазона [firstBeatMidTime, lastBeatMidTime], она **пропускается** — тахограмма в этом
 * окне будет неполной (что и есть честное описание реальности). Иначе при пустом начале
 * окна (новая практика, 60-секундное FFT-окно ещё не заполнено) линейная «экстраполяция
 * назад» порождает абсурдные **отрицательные BPM** — FFT ловит фантомный низкочастотный
 * тренд и даёт высокие Pwin/Ptotal, из-за чего «когерентность» на секундах 1-50 искусственно
 * задирается к 80-100 %. Тот же эффект симметричен в конце окна, если последний удар
 * раньше правого края.
 */
export function buildTachogramBpmSeries(
  cleanedBeats: readonly RrBeatEvent[],
  windowStartMs: number,
  windowEndMs: number,
  sampleRateHz: number = TACHO_SAMPLE_RATE_HZ,
): { timesMs: number[]; bpm: number[] } {
  if (cleanedBeats.length < 2 || windowEndMs <= windowStartMs) {
    return { timesMs: [], bpm: [] };
  }

  const points: { t: number; bpm: number }[] = [];
  for (let i = 1; i < cleanedBeats.length; i += 1) {
    const t0 = cleanedBeats[i - 1]!.timeMs;
    const t1 = cleanedBeats[i]!.timeMs;
    const rr = cleanedBeats[i]!.rrMs;
    if (rr <= 0) {
      continue;
    }
    const bpm = 60000 / rr;
    const mid = (t0 + t1) / 2;
    if (mid >= windowStartMs - 1 && mid <= windowEndMs + 1) {
      points.push({ t: mid, bpm });
    }
  }

  if (points.length < 2) {
    return { timesMs: [], bpm: [] };
  }

  points.sort((a, b) => a.t - b.t);

  const dtMs = 1000 / sampleRateHz;
  const timesMs: number[] = [];
  const bpm: number[] = [];

  const firstT = points[0]!.t;
  const lastT = points[points.length - 1]!.t;

  for (let t = windowStartMs; t <= windowEndMs - 0.5; t += dtMs) {
    // СТРОГО интерполяция — без экстраполяции наружу ближайших реальных BPM-точек.
    if (t < firstT || t > lastT) {
      continue;
    }
    let i = 0;
    while (i < points.length - 2 && points[i + 1]!.t < t) {
      i += 1;
    }
    const p0 = points[i]!;
    const p1 = points[i + 1] ?? p0;
    const span = p1.t - p0.t;
    // НЕ затягиваем дыры от пропадания пальца: если ближайшие реальные beat-точки
    // разнесены больше чем на TACHO_MAX_INTERBEAT_GAP_MS, точка сетки в этом
    // промежутке не генерируется (coverage окна упадёт → insufficientCoverage).
    if (span > TACHO_MAX_INTERBEAT_GAP_MS) {
      continue;
    }
    const w = span > 0 ? (t - p0.t) / span : 0;
    const v = p0.bpm * (1 - w) + p1.bpm * w;
    timesMs.push(t);
    bpm.push(v);
  }

  return { timesMs, bpm };
}
