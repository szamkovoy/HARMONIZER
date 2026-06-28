import { describe, expect, it } from "vitest";

import { summarizeFingerSignalTrust } from "@/modules/biofeedback/core/signal-trust";

function buildSteadyBeats(count: number, startMs = 0, rrMs = 1_000): number[] {
  return Array.from({ length: count }, (_, index) => startMs + index * rrMs);
}

describe("summarizeFingerSignalTrust", () => {
  it("ignores early gap events when a long clean tail remains", () => {
    const rawBeats = buildSteadyBeats(180);
    const metricBeats = [...rawBeats];
    const gapEvents = [
      {
        resumeBeatTimestampMs: 20_000,
        gapMs: 3_200,
      },
    ];

    const withoutGrace = summarizeFingerSignalTrust({
      rawBeats,
      metricBeats,
      gapEvents,
    });
    const withGrace = summarizeFingerSignalTrust({
      rawBeats,
      metricBeats,
      gapEvents,
      applyInitialGraceWindow: true,
    });

    expect(withoutGrace.level).toBe("guided_limited");
    expect(withGrace.level).toBe("full_biometrics");
    expect(withGrace.gapEventCount).toBe(0);
    expect(withGrace.metricBeatCount).toBeLessThan(metricBeats.length);
    expect(withGrace.metricBeatCount).toBeGreaterThan(30);
  });

  it("starts evaluation after minute two when grace-period failures never settle", () => {
    const rawBeats = buildSteadyBeats(180);
    const metricBeats = [...rawBeats];
    const gapEvents = [
      {
        resumeBeatTimestampMs: 58_000,
        gapMs: 3_200,
      },
    ];

    const withGrace = summarizeFingerSignalTrust({
      rawBeats,
      metricBeats,
      gapEvents,
      applyInitialGraceWindow: true,
    });

    expect(withGrace.level).toBe("full_biometrics");
    expect(withGrace.gapEventCount).toBe(0);
    expect(withGrace.metricBeatCount).toBe(120);
  });

  it("keeps early gaps when the post-grace remainder is too short", () => {
    const rawBeats = buildSteadyBeats(100);
    const metricBeats = [...rawBeats];
    const gapEvents = [
      {
        resumeBeatTimestampMs: 20_000,
        gapMs: 3_200,
      },
    ];

    const withGrace = summarizeFingerSignalTrust({
      rawBeats,
      metricBeats,
      gapEvents,
      applyInitialGraceWindow: true,
    });

    expect(withGrace.level).toBe("guided_limited");
    expect(withGrace.gapEventCount).toBe(1);
  });
});
