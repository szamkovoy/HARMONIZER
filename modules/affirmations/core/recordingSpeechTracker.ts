/**
 * Detect long silence at the start/end of a voice take via metering, then
 * keep ~1s pads for playback fade-in/out. If pads are already ≤1s, no trim.
 *
 * Uses an adaptive threshold (noise floor + peak) so constant room noise does
 * not mark the whole take as "speech" and skip trimming.
 */

export const AUDIO_EDGE_KEEP_MS = 1_000;

export type AudioEdgeTrim = {
  startMs: number;
  endMs: number;
};

type Sample = { tMs: number; db: number };

export class RecordingSpeechTracker {
  private readonly samples: Sample[] = [];
  private maxDurationMs = 0;

  /**
   * @param metering expo-av dBFS (typically −160…0)
   * @param durationMillis recording position from status (preferred over wall clock)
   */
  onMetering(
    metering: number | null | undefined,
    durationMillis?: number | null,
  ): void {
    if (typeof metering !== "number" || !Number.isFinite(metering)) return;
    const prevT = this.samples.length ? this.samples[this.samples.length - 1]!.tMs : 0;
    const tMs =
      typeof durationMillis === "number" && Number.isFinite(durationMillis) && durationMillis >= 0
        ? durationMillis
        : prevT + 90;
    this.samples.push({ tMs, db: metering });
    if (tMs > this.maxDurationMs) this.maxDurationMs = tMs;
  }

  /**
   * @param endedDurationMs total recording length when stopping (optional)
   * @returns null when no trim is needed (pads already ≤ keep ms, or no speech).
   */
  finalize(endedDurationMs?: number | null): AudioEdgeTrim | null {
    const durationMs = Math.max(
      typeof endedDurationMs === "number" && Number.isFinite(endedDurationMs)
        ? endedDurationMs
        : 0,
      this.maxDurationMs,
      this.samples.at(-1)?.tMs ?? 0,
    );
    if (durationMs < AUDIO_EDGE_KEEP_MS * 2 || this.samples.length < 5) return null;

    const sorted = this.samples.map((s) => s.db).sort((a, b) => a - b);
    const p25 = sorted[Math.floor((sorted.length - 1) * 0.25)]!;
    const peak = sorted[sorted.length - 1]!;
    // Speech: clearly above noise, and within ~12 dB of the loudest peak.
    const threshold = Math.max(Math.min(peak - 12, p25 + 8), -55);

    let firstRel: number | null = null;
    let lastRel: number | null = null;
    for (const s of this.samples) {
      if (s.db < threshold) continue;
      if (firstRel == null) firstRel = s.tMs;
      lastRel = s.tMs;
    }
    if (firstRel == null || lastRel == null) return null;

    let startMs = 0;
    if (firstRel > AUDIO_EDGE_KEEP_MS) startMs = firstRel - AUDIO_EDGE_KEEP_MS;
    let endMs = durationMs;
    if (durationMs - lastRel > AUDIO_EDGE_KEEP_MS) endMs = lastRel + AUDIO_EDGE_KEEP_MS;
    startMs = Math.floor(startMs);
    endMs = Math.ceil(Math.min(durationMs, Math.max(startMs + AUDIO_EDGE_KEEP_MS, endMs)));
    if (startMs <= 0 && endMs >= durationMs - 40) return null;
    return { startMs, endMs };
  }
}
