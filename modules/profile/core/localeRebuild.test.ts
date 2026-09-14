import { describe, expect, it } from "vitest";

import {
  isLocalePickAborted,
  isRedundantLocalePick,
  isStaleLocaleOp,
  LocalePickAbortedError,
  raceAbortTimeout,
} from "@/modules/profile/core/localeRebuild";

describe("isRedundantLocalePick", () => {
  it("ignores picking the already committed locale when nothing is in flight", () => {
    expect(
      isRedundantLocalePick({ code: "ru", committed: "ru", optimistic: null, phase: "idle" }),
    ).toBe(true);
  });

  it("ignores re-tapping the in-flight language while probing/confirm/loading", () => {
    expect(
      isRedundantLocalePick({ code: "en", committed: "ru", optimistic: "en", phase: "probing" }),
    ).toBe(true);
    expect(
      isRedundantLocalePick({ code: "en", committed: "ru", optimistic: "en", phase: "confirm" }),
    ).toBe(true);
  });

  it("retries a stuck optimistic combo for every shipped locale", () => {
    const locales = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
    for (const code of locales) {
      expect(
        isRedundantLocalePick({ code, committed: "ru", optimistic: code, phase: "idle" }),
      ).toBe(false);
    }
  });

  it("starts a new pick when the user chooses a different language", () => {
    expect(
      isRedundantLocalePick({ code: "de", committed: "ru", optimistic: "en", phase: "confirm" }),
    ).toBe(false);
  });
});

describe("isStaleLocaleOp", () => {
  it("treats a newer op id as stale even if the old signal is still open", () => {
    const signal = new AbortController().signal;
    expect(isStaleLocaleOp(1, 2, signal)).toBe(true);
    expect(isStaleLocaleOp(2, 2, signal)).toBe(false);
  });

  it("treats an aborted signal as stale for the same op", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isStaleLocaleOp(1, 1, controller.signal)).toBe(true);
  });
});

describe("raceAbortTimeout", () => {
  it("resolves the value when the probe finishes before abort/timeout", async () => {
    const controller = new AbortController();
    await expect(raceAbortTimeout(Promise.resolve("ready"), controller.signal, 50)).resolves.toBe(
      "ready",
    );
  });

  it("does not reject if the shared controller is aborted after success (probe→ensure)", async () => {
    const controller = new AbortController();
    const result = raceAbortTimeout(Promise.resolve("ready"), controller.signal, 1_000);
    const value = await result;
    controller.abort();
    expect(value).toBe("ready");
    await expect(result).resolves.toBe("ready");
  });

  it("rejects with LocalePickAbortedError when aborted before settle", async () => {
    const controller = new AbortController();
    const pending = raceAbortTimeout(new Promise(() => undefined), controller.signal, 1_000);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(LocalePickAbortedError);
  });

  it("rejects on timeout so the caller can show the confirm dialog", async () => {
    const controller = new AbortController();
    await expect(
      raceAbortTimeout(new Promise(() => undefined), controller.signal, 10),
    ).rejects.toThrow("locale probe timeout");
  });

  it("identifies abort errors for silent vs confirm handling", () => {
    expect(isLocalePickAborted(new LocalePickAbortedError())).toBe(true);
    expect(isLocalePickAborted(new Error("locale probe timeout"))).toBe(false);
  });
});
