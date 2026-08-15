/**
 * Detect long silence at the start/end of a voice take via metering, then
 * keep ~1s pads for playback fade-in/out. If pads are already ≤1s, no trim.
 */

export const AUDIO_EDGE_KEEP_MS = 1_000;
/** expo-av metering is roughly dBFS; speech usually sits above this. */
const SPEECH_METERING_THRESHOLD = -42;

export type AudioEdgeTrim = {
  startMs: number;
  endMs: number;
};

export class RecordingSpeechTracker {
  private readonly startedAt: number;
  private firstSpeechAt: number | null = null;
  private lastSpeechAt: number | null = null;

  constructor(startedAt = Date.now()) {
    this.startedAt = startedAt;
  }

  onMetering(metering: number | null | undefined, now = Date.now()): void {
    if (typeof metering !== "number" || !Number.isFinite(metering)) return;
    if (metering < SPEECH_METERING_THRESHOLD) return;
    if (this.firstSpeechAt == null) this.firstSpeechAt = now;
    this.lastSpeechAt = now;
  }

  /**
   * @returns null when no trim is needed (speech pads already ≤ keep ms, or no speech).
   */
  finalize(endedAt = Date.now()): AudioEdgeTrim | null {
    if (this.firstSpeechAt == null || this.lastSpeechAt == null) return null;
    const durationMs = Math.max(0, endedAt - this.startedAt);
    if (durationMs < AUDIO_EDGE_KEEP_MS * 2) return null;
    const firstRel = Math.max(0, this.firstSpeechAt - this.startedAt);
    const lastRel = Math.max(firstRel, this.lastSpeechAt - this.startedAt);
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
