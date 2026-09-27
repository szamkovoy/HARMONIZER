import { describe, expect, it } from "vitest";

import { signEmailTrackToken } from "./emailFirstPartyTracking";
import { parseEmailTrackTokenEdge } from "./emailOpenTrack";

describe("parseEmailTrackTokenEdge", () => {
  it("accepts a token signed by the Node helper", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    process.env.EMAIL_TRACKING_SECRET = "test-track-secret";
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "";
    const token = signEmailTrackToken(id);
    expect(await parseEmailTrackTokenEdge(token)).toBe(id);
    expect(await parseEmailTrackTokenEdge(`${token}ff`)).toBeNull();
  });
});
