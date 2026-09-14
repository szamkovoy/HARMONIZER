import { describe, expect, it } from "vitest";

import { mergeAbortSignals, shouldRetrySupabaseGatewayResponse } from "./supabase";

describe("shouldRetrySupabaseGatewayResponse", () => {
  it("retries idempotent reads up to twice on gateway 502/503/504", () => {
    expect(shouldRetrySupabaseGatewayResponse(504, "GET", 0)).toBe(true);
    expect(shouldRetrySupabaseGatewayResponse(503, "get", 0)).toBe(true);
    expect(shouldRetrySupabaseGatewayResponse(502, "HEAD", 0)).toBe(true);
    expect(shouldRetrySupabaseGatewayResponse(504, "GET", 1)).toBe(true);
    expect(shouldRetrySupabaseGatewayResponse(504, "GET", 2)).toBe(false);
  });

  it("never retries writes, RPC, or non-gateway statuses", () => {
    expect(shouldRetrySupabaseGatewayResponse(504, "POST", 0)).toBe(false);
    expect(shouldRetrySupabaseGatewayResponse(504, "PATCH", 0)).toBe(false);
    expect(shouldRetrySupabaseGatewayResponse(504, "DELETE", 0)).toBe(false);
    expect(shouldRetrySupabaseGatewayResponse(500, "GET", 0)).toBe(false);
    expect(shouldRetrySupabaseGatewayResponse(200, "GET", 0)).toBe(false);
  });
});

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
