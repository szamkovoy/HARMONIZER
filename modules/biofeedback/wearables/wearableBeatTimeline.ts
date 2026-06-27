import { COHERENCE_BEAT_DEDUPE_MS } from "@/modules/breath/core/coherence-constants";

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

  const packetBeats: number[] = [];
  let t = nowMs;
  packetBeats.push(t);
  for (let i = rrIntervalsMs.length - 1; i >= 0; i -= 1) {
    t -= rrIntervalsMs[i]!;
    packetBeats.unshift(t);
  }

  // BLE-стрим (Polar H10 и др.) часто присылает 2+ RR в одном notify; backward-chain
  // включает интервалы, уже закоммиченные прошлым пакетом → «пила» 750/250 ms и rrBadFraction>20%.
  const cutoffMs =
    dedupeAnchor == null ? Number.NEGATIVE_INFINITY : dedupeAnchor + dedupeMs;
  const beatTimestampsMs = packetBeats.filter((beatTs) => beatTs > cutoffMs);

  const nextLastBeat =
    beatTimestampsMs.length > 0
      ? beatTimestampsMs[beatTimestampsMs.length - 1]!
      : dedupeAnchor;

  return {
    beatTimestampsMs,
    lastBeatTimestampMs: nextLastBeat ?? lastBeatTimestampMs,
  };
}
