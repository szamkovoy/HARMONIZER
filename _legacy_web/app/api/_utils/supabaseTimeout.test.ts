import { describe, expect, it } from "vitest";

import { mergeAbortSignals } from "./supabase";

describe("mergeAbortSignals", () => {
  it("aborts when either input signal aborts", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const merged = mergeAbortSignals([first.signal, second.signal]);
    expect(merged.aborted).toBe(false);
    second.abort();
    expect(merged.aborted).toBe(true);
  });

  it("returns an already-aborted signal immediately", () => {
    const controller = new AbortController();
    controller.abort();
    const merged = mergeAbortSignals([controller.signal, new AbortController().signal]);
    expect(merged.aborted).toBe(true);
  });
});
