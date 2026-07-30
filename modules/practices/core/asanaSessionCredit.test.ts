import { describe, expect, it } from "vitest";

import {
  ASANA_COMPLETION_TAIL_SEC,
  asanaCreditedDurationSec,
  asanaTargetDurationSec,
  asanaWatchedSec,
  isAsanaCompleted,
} from "@/modules/practices/core/asanaSessionCredit";

describe("asanaSessionCredit", () => {
  it("uses the longer of catalog and player duration", () => {
    expect(asanaTargetDurationSec(1094, 0)).toBe(1094);
    expect(asanaTargetDurationSec(0, 1200)).toBe(1200);
    expect(asanaTargetDurationSec(1000, 1100)).toBe(1100);
  });

  it("takes max of player elapsed and wall clock", () => {
    expect(asanaWatchedSec(0, 1200)).toBe(1200);
    expect(asanaWatchedSec(800, 100)).toBe(800);
  });

  it("marks complete within closing tail or on ended", () => {
    const target = 20 * 60;
    expect(
      isAsanaCompleted({
        practiceEnded: false,
        watchedSec: target - ASANA_COMPLETION_TAIL_SEC,
        targetDurationSec: target,
      }),
    ).toBe(true);
    expect(
      isAsanaCompleted({
        practiceEnded: false,
        watchedSec: target - ASANA_COMPLETION_TAIL_SEC - 1,
        targetDurationSec: target,
      }),
    ).toBe(false);
    expect(
      isAsanaCompleted({
        practiceEnded: true,
        watchedSec: 30,
        targetDurationSec: target,
      }),
    ).toBe(true);
  });

  it("credits wall-clock finish when Vimeo elapsed stayed at 0 (bridge miss)", () => {
    const target = 1094;
    const watched = asanaWatchedSec(0, 1100);
    expect(isAsanaCompleted({ practiceEnded: false, watchedSec: watched, targetDurationSec: target })).toBe(
      true,
    );
    expect(asanaCreditedDurationSec({ watchedSec: watched, targetDurationSec: target })).toBe(target);
  });
});
