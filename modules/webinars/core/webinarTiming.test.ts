import { describe, expect, it } from "vitest";

import {
  isWebinarInJoinWindow,
  isWebinarRecordingTabAvailable,
  webinarJoinWindowEndsAt,
} from "./webinarTiming";

describe("webinarTiming", () => {
  const startsAt = "2026-07-13T15:00:00.000Z";

  it("keeps join window open for one hour after start", () => {
    const startMs = Date.parse(startsAt);
    expect(isWebinarInJoinWindow(startsAt, startMs - 60_000)).toBe(true);
    expect(isWebinarInJoinWindow(startsAt, startMs + 30 * 60_000)).toBe(true);
    expect(isWebinarInJoinWindow(startsAt, startMs + 60 * 60_000)).toBe(false);
    expect(webinarJoinWindowEndsAt(startsAt).toISOString()).toBe("2026-07-13T16:00:00.000Z");
  });

  it("opens recording tab only after join window ends", () => {
    const startMs = Date.parse(startsAt);
    expect(isWebinarRecordingTabAvailable(startsAt, startMs + 30 * 60_000)).toBe(false);
    expect(isWebinarRecordingTabAvailable(startsAt, startMs + 60 * 60_000)).toBe(true);
  });
});
