import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-application", () => ({
  applicationId: "com.zamkovoi.harmonizer",
}));

vi.mock("harmonizer-android-restore-credentials", () => ({
  isRestoreCredentialsNativeSupported: () => false,
  nativeClearRestoreCredentialState: async () => undefined,
  nativeCreateRestoreCredential: async () => "{}",
  nativeGetRestoreCredential: async () => null,
}));

vi.mock("@/services/supabase", () => ({
  getSupabaseAccessToken: async () => null,
  getSupabaseSessionSnapshot: async () => null,
  requireSupabase: () => ({ auth: { setSession: async () => ({ error: null }) } }),
}));

import { settleWithTimeout } from "./restoreCredentials";

describe("settleWithTimeout", () => {
  it("resolves when the work finishes first", async () => {
    const started = Date.now();
    await settleWithTimeout(Promise.resolve("ok"), 500);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("resolves when the work rejects", async () => {
    await settleWithTimeout(Promise.reject(new Error("nope")), 500);
  });

  it("does not wait for a hung promise past the budget", async () => {
    const hung = new Promise(() => undefined);
    const started = Date.now();
    await settleWithTimeout(hung, 40);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(Date.now() - started).toBeLessThan(250);
  });
});
