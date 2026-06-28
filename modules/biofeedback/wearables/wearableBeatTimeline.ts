import { COHERENCE_BEAT_DEDUPE_MS } from "@/modules/breath/core/coherence-constants";

function buildPacketBeatsBackward(nowMs: number, rrIntervalsMs: readonly number[]): number[] {
  const packetBeats: number[] = [];
  let t = nowMs;
  packetBeats.push(t);
  for (let i = rrIntervalsMs.length - 1; i >= 0; i -= 1) {
    t -= rrIntervalsMs[i]!;
    packetBeats.unshift(t);
  }
  return packetBeats;
}

function chooseNewIntervalCount(
  nowMs: number,
  rrIntervalsMs: readonly number[],
  lastBeatTimestampMs: number,
): number | null {
  let bestCount: number | null = null;
  let bestLagMs = Number.POSITIVE_INFINITY;
  let suffixSumMs = 0;

  for (let count = 1; count <= rrIntervalsMs.length; count += 1) {
    suffixSumMs += rrIntervalsMs[rrIntervalsMs.length - count]!;
    const candidateLatestBeatMs = lastBeatTimestampMs + suffixSumMs;
    const lagMs = nowMs - candidateLatestBeatMs;
    if (lagMs < 0) {
      continue;
    }
    if (lagMs < bestLagMs) {
      bestLagMs = lagMs;
      bestCount = count;
    }
  }

  return bestCount;
}

/**
 * Строит абсолютные метки ударов из одного BLE Heart Rate Measurement пакета.
 *
 * По HRS rr[0] — самый старый интервал, rr[n-1] — последний перед текущим ударом;
 * текущий удар ≈ `nowMs`. Из пакета берутся только метки **после** последнего
 * committed beat — иначе multi-RR notify (Polar) повторно вставляет историю и
 * ломает RR-пилу (rrBadFraction ≥ 20%).
 */
export function buildBeatTimestampsFromRrPacket(
  nowMs: number,
  rrIntervalsMs: readonly number[],
  lastBeatTimestampMs: number | null,
  options: { dedupeMs?: number; resetTimeline?: boolean } = {},
): { beatTimestampsMs: number[]; lastBeatTimestampMs: number | null } {
  if (!rrIntervalsMs.length) {
    return { beatTimestampsMs: [], lastBeatTimestampMs };
  }

  const dedupeMs = options.dedupeMs ?? COHERENCE_BEAT_DEDUPE_MS;
  const dedupeAnchor = options.resetTimeline ? null : lastBeatTimestampMs;

  if (dedupeAnchor == null) {
    const packetBeats = buildPacketBeatsBackward(nowMs, rrIntervalsMs);
    return {
      beatTimestampsMs: packetBeats,
      lastBeatTimestampMs: packetBeats[packetBeats.length - 1] ?? lastBeatTimestampMs,
    };
  }

  /**
   * Когда у нас уже есть последний подтверждённый beat, `nowMs` больше не должен
   * становиться «истиной» для каждого notify: transport lag BLE гуляет на сотни мс
   * и превращает ровный RR-ряд ремня в пилу 800/250/750/220.
   *
   * Вместо этого выбираем, сколько RR из хвоста пакета действительно новые
   * относительно последнего committed beat. Критерий: у лучшего кандидата
   * latestBeat = lastBeat + sum(latest RR...) должен давать минимальный
   * неотрицательный lag до `nowMs`.
   */
  const newIntervalCount = chooseNewIntervalCount(nowMs, rrIntervalsMs, dedupeAnchor);
  if (newIntervalCount == null) {
    const packetBeats = buildPacketBeatsBackward(nowMs, rrIntervalsMs);
    const cutoffMs = dedupeAnchor + dedupeMs;
    const beatTimestampsMs = packetBeats.filter((beatTs) => beatTs > cutoffMs);
    const nextLastBeat =
      beatTimestampsMs.length > 0
        ? beatTimestampsMs[beatTimestampsMs.length - 1]!
        : dedupeAnchor;
    return {
      beatTimestampsMs,
      lastBeatTimestampMs: nextLastBeat,
    };
  }

  const beatTimestampsMs: number[] = [];
  let t = dedupeAnchor;
  for (let i = rrIntervalsMs.length - newIntervalCount; i < rrIntervalsMs.length; i += 1) {
    t += rrIntervalsMs[i]!;
    if (t > dedupeAnchor + dedupeMs) {
      beatTimestampsMs.push(t);
    }
  }

  const nextLastBeat =
    beatTimestampsMs.length > 0
      ? beatTimestampsMs[beatTimestampsMs.length - 1]!
      : dedupeAnchor;

  return {
    beatTimestampsMs,
    lastBeatTimestampMs: nextLastBeat ?? lastBeatTimestampMs,
  };
}
