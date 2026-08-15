import { describe, expect, it } from "vitest";

import {
  AUDIO_EDGE_KEEP_MS,
  RecordingSpeechTracker,
} from "./recordingSpeechTracker";

describe("RecordingSpeechTracker", () => {
  it("returns null when speech pads are already within keep window", () => {
    const t0 = 1_000_000;
    const tracker = new RecordingSpeechTracker(t0);
    tracker.onMetering(-20, t0 + 400);
    tracker.onMetering(-18, t0 + 2_000);
    expect(tracker.finalize(t0 + 2_400)).toBeNull();
  });

  it("keeps 1s pads when silence on both edges exceeds keep", () => {
    const t0 = 1_000_000;
    const tracker = new RecordingSpeechTracker(t0);
    tracker.onMetering(-20, t0 + 3_000);
    tracker.onMetering(-18, t0 + 5_000);
    const trim = tracker.finalize(t0 + 8_000);
    expect(trim).toEqual({
      startMs: 3_000 - AUDIO_EDGE_KEEP_MS,
      endMs: 5_000 + AUDIO_EDGE_KEEP_MS,
    });
  });
});
