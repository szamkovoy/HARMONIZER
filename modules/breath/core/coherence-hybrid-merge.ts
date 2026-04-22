/**
 * Слияние результатов `runCoherenceSessionAnalysis` для двух независимых
 * реальных окон гибридного режима (начало и конец практики без участка
 * эмуляции пульса).
 *
 * REMOVE_ME_HYBRID_MERGE — логика специфична для гибридного измерения; при
 * упрощении продукта можно оставить только одиночный анализ.
 */

import type { CoherenceSessionResult } from "@/modules/breath/core/coherence-session-analysis";

const HYBRID_AGGREGATE_NOTE =
  "Гибридное измерение: поминутная когерентность, RSA и агрегаты ниже построены только по двум окнам реального PPG (начало и конец практики), без участка эмуляции пульса.";

/**
 * Префикс warning'а из `coherence-session-analysis` на случай, когда в окне
 * так и не нашли 15 секунд подряд с когерентностью ≥ порога. В гибридном
 * режиме этот warning бессмысленен, если хотя бы одно из окон **всё-таки**
 * достигло вхождения — пользователь видит «202 с» в UI, а рядом — жалобу
 * «максимум подряд: 0 с» из другого окна, и это сбивает с толку.
 */
const ENTRY_TIME_NOT_DEFINED_PREFIX = "Время вхождения не определено";

function mergeNullableWeighted(
  a: number | null,
  b: number | null,
  wA: number,
  wB: number,
): number | null {
  if (a != null && b != null && wA + wB > 0) {
    return (a * wA + b * wB) / (wA + wB);
  }
  if (a != null) return a;
  if (b != null) return b;
  return null;
}

/**
 * Объединяет два результата анализа в один объект для `CoherenceSessionResult`
 * экспорта / верхнего блока отладки. Не усредняет RMSSD/стресс — они считаются
 * отдельно по окнам в UI.
 */
export function mergeHybridCoherenceSessionResults(
  resStart: CoherenceSessionResult,
  resEnd: CoherenceSessionResult,
): CoherenceSessionResult {
  const wA = Math.max(0, resStart.practiceDurationSec);
  const wB = Math.max(0, resEnd.practiceDurationSec);

  /** Смещение индекса секунд для второго окна (длина поминутного ряда первого). */
  const offsetSec = resStart.perSecond.length;

  const perSecond = [
    ...resStart.perSecond,
    ...resEnd.perSecond.map((p) => ({
      ...p,
      secondIndex: p.secondIndex + offsetSec,
    })),
  ];

  const perSecondSmoothed = [
    ...resStart.perSecondSmoothed,
    ...resEnd.perSecondSmoothed.map((p) => ({
      secondIndex: p.secondIndex + offsetSec,
      coherenceMappedPercent: p.coherenceMappedPercent,
    })),
  ];

  const cycleOffset = resStart.rsaCycles.length;
  const rsaCycles = [
    ...resStart.rsaCycles,
    ...resEnd.rsaCycles.map((c, i) => ({
      ...c,
      cycleIndex: cycleOffset + i,
    })),
  ];

  const beatTimestampsMsBeforeDedupe = [
    ...resStart.beatTimestampsMsBeforeDedupe,
    ...resEnd.beatTimestampsMsBeforeDedupe,
  ]
    .slice()
    .sort((a, b) => a - b);

  const beatTimestampsMsAnalyzed = [...resStart.beatTimestampsMsAnalyzed, ...resEnd.beatTimestampsMsAnalyzed]
    .slice()
    .sort((a, b) => a - b);

  /**
   * Если вхождение достигнуто хотя бы в одном окне — отфильтровываем из
   * агрегата жалобы «не определено» от обоих окон. Сами окна оставляют
   * warning в своих `hybridStart/EndExportMetaJson`, а на верхнем уровне
   * агрегата он лишний: UI уже показывает корректное время в «в начале».
   */
  const anyEntryDefined = resStart.entryTimeSec != null || resEnd.entryTimeSec != null;
  const warningsRaw = [HYBRID_AGGREGATE_NOTE, ...resStart.warnings, ...resEnd.warnings];
  const warningsFiltered = anyEntryDefined
    ? warningsRaw.filter((w) => !w.startsWith(ENTRY_TIME_NOT_DEFINED_PREFIX))
    : warningsRaw;
  const seen = new Set<string>();
  const warnings = warningsFiltered.filter((w) => (seen.has(w) ? false : (seen.add(w), true)));

  /**
   * Агрегатное `entryTimeSec`: предпочитаем start-окно (там вхождение
   * естественнее — человек входит в когерентность в начале практики). Если
   * только end-окно дало вхождение, индекс смещаем на длину start-окна,
   * чтобы совпадал с `perSecond[i].secondIndex` объединённого ряда.
   */
  const entryTimeSecMerged =
    resStart.entryTimeSec != null
      ? resStart.entryTimeSec
      : resEnd.entryTimeSec != null
        ? resEnd.entryTimeSec + offsetSec
        : null;

  const totalValidDataSeconds = resStart.totalValidDataSeconds + resEnd.totalValidDataSeconds;

  const metricsWithheldDueToInsufficientData =
    resStart.metricsWithheldDueToInsufficientData || resEnd.metricsWithheldDueToInsufficientData;

  return {
    algorithmVersion: resStart.algorithmVersion,
    mode: resStart.mode,
    sessionDurationSec: resStart.sessionDurationSec + resEnd.sessionDurationSec,
    practiceDurationSec: resStart.practiceDurationSec + resEnd.practiceDurationSec,
    skipFirstSecondsForAggregate: Math.max(
      resStart.skipFirstSecondsForAggregate,
      resEnd.skipFirstSecondsForAggregate,
    ),
    windowSeconds: resStart.windowSeconds,
    metricsApproximate: resStart.metricsApproximate || resEnd.metricsApproximate,
    beatTimestampsMsBeforeDedupe,
    beatTimestampsMsAnalyzed,
    coherenceAveragePercent: mergeNullableWeighted(
      resStart.coherenceAveragePercent,
      resEnd.coherenceAveragePercent,
      wA,
      wB,
    ),
    coherenceMaxPercent:
      resStart.coherenceMaxPercent == null && resEnd.coherenceMaxPercent == null
        ? null
        : Math.max(resStart.coherenceMaxPercent ?? 0, resEnd.coherenceMaxPercent ?? 0),
    rsaAmplitudeBpm: mergeNullableWeighted(
      resStart.rsaAmplitudeBpm,
      resEnd.rsaAmplitudeBpm,
      wA,
      wB,
    ),
    rsaNormalizedPercent: mergeNullableWeighted(
      resStart.rsaNormalizedPercent,
      resEnd.rsaNormalizedPercent,
      wA,
      wB,
    ),
    entryTimeSec: entryTimeSecMerged,
    perSecond,
    perSecondSmoothed,
    rsaCycles,
    warnings,
    totalValidDataSeconds,
    metricsWithheldDueToInsufficientData,
    exportMeta: {
      hybridMergedFromRealWindows: true,
      hybridPracticeDurationStartSec: resStart.practiceDurationSec,
      hybridPracticeDurationEndSec: resEnd.practiceDurationSec,
      mergedTotalValidDataSeconds: totalValidDataSeconds,
      hybridStartExportMetaJson: JSON.stringify(resStart.exportMeta),
      hybridEndExportMetaJson: JSON.stringify(resEnd.exportMeta),
    },
  };
}
