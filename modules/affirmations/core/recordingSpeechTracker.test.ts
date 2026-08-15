import { describe, expect, it } from "vitest";

import {
  AUDIO_EDGE_KEEP_MS,
  RecordingSpeechTracker,
} from "./recordingSpeechTracker";

function feed(
  tracker: RecordingSpeechTracker,
  fromMs: number,
  toMs: number,
  db: number,
  step = 90,
) {
  for (let t = fromMs; t <= toMs; t += step) {
    tracker.onMetering(db, t);
  }
}

describe("RecordingSpeechTracker", () => {
  it("returns null when speech pads are already within keep window", () => {
    const tracker = new RecordingSpeechTracker();
    feed(tracker, 0, 400, -50);
    feed(tracker, 400, 2_000, -18);
    feed(tracker, 2_000, 2_400, -50);
    expect(tracker.finalize(2_400)).toBeNull();
  });

  it("keeps 1s pads when silence on both edges exceeds keep", () => {
    const tracker = new RecordingSpeechTracker();
    feed(tracker, 0, 2_900, -55);
    feed(tracker, 3_000, 5_000, -18);
    feed(tracker, 5_100, 8_000, -55);
    const trim = tracker.finalize(8_000);
    expect(trim).not.toBeNull();
    expect(trim!.startMs).toBe(3_000 - AUDIO_EDGE_KEEP_MS);
    // Last speech sample is ≤5000 due to 90ms step.
    expect(trim!.endMs).toBeGreaterThanOrEqual(5_000);
    expect(trim!.endMs).toBeLessThanOrEqual(5_000 + AUDIO_EDGE_KEEP_MS);
  });

  it("trims despite constant room noise below speech peak", () => {
    const tracker = new RecordingSpeechTracker();
    feed(tracker, 0, 2_900, -35);
    feed(tracker, 3_000, 5_000, -18);
    feed(tracker, 5_100, 8_000, -35);
    const trim = tracker.finalize(8_000);
    expect(trim).not.toBeNull();
    expect(trim!.startMs).toBe(3_000 - AUDIO_EDGE_KEEP_MS);
    expect(trim!.endMs).toBeGreaterThanOrEqual(5_000);
    expect(trim!.endMs).toBeLessThanOrEqual(5_000 + AUDIO_EDGE_KEEP_MS);
  });
});
