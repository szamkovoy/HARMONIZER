import { COHERENCE_BEAT_DEDUPE_MS } from "@/modules/breath/core/coherence-constants";

/**
 * Строит абсолютные метки ударов из одного BLE Heart Rate Measurement пакета.
 *
 * По HRS rr[0] — самый старый интервал, rr[n-1] — последний перед текущим ударом;
 * текущий удар ≈ `nowMs`. Старый forward-accumulate от `lastBeat` давал RR 3–5 с
 * при нормальном chest-strap и ломал тахограмму/coherence.
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

  const beatTimestampsMs: number[] = [];
  let lastTs = dedupeAnchor;
  for (const beatTs of packetBeats) {
    if (lastTs != null && beatTs <= lastTs + dedupeMs) {
      continue;
    }
    beatTimestampsMs.push(beatTs);
    lastTs = beatTs;
  }

  return {
    beatTimestampsMs,
    lastBeatTimestampMs: lastTs ?? lastBeatTimestampMs,
  };
}
