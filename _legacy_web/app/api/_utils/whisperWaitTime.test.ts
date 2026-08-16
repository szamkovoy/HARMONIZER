import { describe, expect, it } from "vitest";
import {
  clampWaitMs,
  extractWaitTimeMs,
  isGroqFailoverStatus,
  ladderDelayMs,
  LADDER_MS,
  parseDurationToMs,
  WAIT_MS_MAX,
} from "./whisperWaitTime";

describe("parseDurationToMs", () => {
  it("parses bare seconds", () => {
    expect(parseDurationToMs("12.4")).toBe(12_400);
    expect(parseDurationToMs("2")).toBe(2_000);
  });

  it("parses compound Groq reset strings", () => {
    expect(parseDurationToMs("7.66s")).toBe(7_660);
    expect(parseDurationToMs("2m59.56s")).toBe(2 * 60_000 + 59_560);
    expect(parseDurationToMs("1h15m30s")).toBe(1 * 3_600_000 + 15 * 60_000 + 30_000);
    expect(parseDurationToMs("6m 11.52s")).toBe(6 * 60_000 + 11_520);
  });

  it("returns null for garbage", () => {
    expect(parseDurationToMs("")).toBeNull();
    expect(parseDurationToMs("soon")).toBeNull();
  });
});

describe("clampWaitMs", () => {
  it("rejects over 24h as invalid", () => {
    expect(clampWaitMs(WAIT_MS_MAX + 1)).toBeNull();
  });

  it("floors tiny values to 1s", () => {
    expect(clampWaitMs(50)).toBe(1_000);
  });
});

describe("extractWaitTimeMs", () => {
  it("prefers retry-after", () => {
    const headers = new Headers({ "retry-after": "8.5" });
    expect(extractWaitTimeMs({ headers, bodyText: "Please try again in 99h" })).toBe(8_500);
  });

  it("reads x-ratelimit-reset-requests", () => {
    const headers = new Headers({ "x-ratelimit-reset-requests": "2m59.56s" });
    expect(extractWaitTimeMs({ headers })).toBe(2 * 60_000 + 59_560);
  });

  it("parses Groq error.message", () => {
    const body = JSON.stringify({
      error: {
        message:
          "Rate limit reached for model whisper-large-v3... Please try again in 6m 11.52s.",
        type: "tokens",
        code: "rate_limit_exceeded",
      },
    });
    expect(extractWaitTimeMs({ bodyText: body })).toBe(6 * 60_000 + 11_520);
  });

  it("returns null when nothing usable", () => {
    expect(extractWaitTimeMs({ bodyText: '{"error":{"message":"boom"}}' })).toBeNull();
  });
});

describe("ladderDelayMs", () => {
  it("escalates 2m → 70m → 23h", () => {
    expect(ladderDelayMs(1)).toBe(LADDER_MS[0]);
    expect(ladderDelayMs(2)).toBe(LADDER_MS[1]);
    expect(ladderDelayMs(3)).toBe(LADDER_MS[2]);
    expect(ladderDelayMs(99)).toBe(LADDER_MS[2]);
  });
});

describe("isGroqFailoverStatus", () => {
  it("fails over on 429 and 5xx only", () => {
    expect(isGroqFailoverStatus(429)).toBe(true);
    expect(isGroqFailoverStatus(503)).toBe(true);
    expect(isGroqFailoverStatus(400)).toBe(false);
    expect(isGroqFailoverStatus(401)).toBe(false);
  });
});
