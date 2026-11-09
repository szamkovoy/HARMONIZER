import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supabase", () => {
  const rpc = vi.fn();
  const signInWithOtp = vi.fn();
  const verifyOtp = vi.fn();
  const updateUser = vi.fn();
  const client = {
    rpc,
    auth: { signInWithOtp, verifyOtp, updateUser, setSession: vi.fn() },
  };
  return {
    requireSupabase: () => client,
    __rpc: rpc,
    __signInWithOtp: signInWithOtp,
    __verifyOtp: verifyOtp,
    __updateUser: updateUser,
  };
});

vi.mock("@/modules/i18n", () => ({
  getResponseLocale: () => "ru",
}));

vi.mock("@/modules/auth/otpGate", () => ({
  requestOtpSendPermit: vi.fn().mockResolvedValue(undefined),
  OtpGateError: class OtpGateError extends Error {
    code: string;
    retryAfterSeconds?: number;
    constructor(code: string, retryAfterSeconds?: number) {
      super(`otp_gate:${code}`);
      this.name = "OtpGateError";
      this.code = code;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
}));

vi.mock("@/modules/auth/otpCooldown", () => ({
  markOtpCooldown: vi.fn().mockResolvedValue(undefined),
  readOtpCooldownRemainingSec: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/services/runtimeDiagnostics", () => ({
  logRuntimeEvent: vi.fn(),
  logRuntimeTap: vi.fn(),
}));

import { requestEmailOtpCode, raceBudget, isOtpClientAbort } from "./sign-in-email";
// @ts-expect-error — internal mock handles exported by the factory above
import { __rpc, __signInWithOtp } from "@/services/supabase";
import { markOtpCooldown } from "@/modules/auth/otpCooldown";

const mocks = {
  __rpc: __rpc as ReturnType<typeof vi.fn>,
  __signInWithOtp: __signInWithOtp as ReturnType<typeof vi.fn>,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("raceBudget", () => {
  it("returns the value when the promise resolves first", async () => {
    expect(await raceBudget(Promise.resolve("ok"), 100)).toBe("ok");
  });

  it("returns timeout when the promise is still pending", async () => {
    const hung = new Promise(() => undefined);
    const started = Date.now();
    expect(await raceBudget(hung, 40)).toBe("timeout");
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it("returns timeout when the promise rejects after the budget", async () => {
    const lateReject = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("late")), 50);
    });
    expect(await raceBudget(lateReject, 10)).toBe("timeout");
  });
});

describe("isOtpClientAbort", () => {
  it("detects AbortError by name", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isOtpClientAbort(err)).toBe(true);
  });

  it("detects abort by message", () => {
    expect(isOtpClientAbort(new Error("The operation was aborted"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isOtpClientAbort(new Error("Network request failed"))).toBe(false);
    expect(isOtpClientAbort(null)).toBe(false);
    expect(isOtpClientAbort(undefined)).toBe(false);
  });
});

describe("requestEmailOtpCode", () => {
  it("opens the code screen when signInWithOtp resolves fast", async () => {
    mocks.__signInWithOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: null });
    mocks.__rpc.mockResolvedValueOnce({ error: null });

    await expect(requestEmailOtpCode("sergei@zamkovoi.yoga", "Сергей")).resolves.toBeUndefined();
    expect(markOtpCooldown).toHaveBeenCalledWith(60);
  });

  it("throws when signInWithOtp returns an error fast", async () => {
    mocks.__signInWithOtp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "rate limit exceeded" },
    });
    mocks.__rpc.mockResolvedValueOnce({ error: null });

    await expect(
      requestEmailOtpCode("sergei@zamkovoi.yoga", "Сергей"),
    ).rejects.toThrow(/rate limit/i);
  });

  it("opens the code screen when signInWithOtp hangs past the budget", async () => {
    mocks.__signInWithOtp.mockReturnValueOnce(new Promise(() => undefined));
    mocks.__rpc.mockResolvedValueOnce({ error: null });

    await expect(
      requestEmailOtpCode("sergei@zamkovoi.yoga", "Сергей", { responseBudgetMs: 30, hintBudgetMs: 10 }),
    ).resolves.toBeUndefined();
    expect(markOtpCooldown).toHaveBeenCalledWith(60);
  });

  it("opens the code screen when the fetch aborts after the budget", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    mocks.__signInWithOtp.mockReturnValueOnce(
      new Promise((_resolve, reject) => setTimeout(() => reject(abortErr), 40)),
    );
    mocks.__rpc.mockResolvedValueOnce({ error: null });

    await expect(
      requestEmailOtpCode("sergei@zamkovoi.yoga", "Сергей", { responseBudgetMs: 20, hintBudgetMs: 10 }),
    ).resolves.toBeUndefined();
    expect(markOtpCooldown).toHaveBeenCalledWith(60);
  });

  it("rethrows a fast offline failure that is not our abort", async () => {
    mocks.__signInWithOtp.mockRejectedValueOnce(new Error("Network request failed"));
    mocks.__rpc.mockResolvedValueOnce({ error: null });

    await expect(
      requestEmailOtpCode("sergei@zamkovoi.yoga", "Сергей", { responseBudgetMs: 1000, hintBudgetMs: 10 }),
    ).rejects.toThrow(/Network request failed/i);
  });

  it("sends even when the name hint hangs", async () => {
    mocks.__rpc.mockReturnValueOnce(new Promise(() => undefined));
    mocks.__signInWithOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: null });

    await expect(
      requestEmailOtpCode("sergei@zamkovoi.yoga", "Сергей", { hintBudgetMs: 10, responseBudgetMs: 1000 }),
    ).resolves.toBeUndefined();
    expect(mocks.__signInWithOtp).toHaveBeenCalled();
  });

  it("sends even when the name hint rejects", async () => {
    mocks.__rpc.mockRejectedValueOnce(new Error("rpc down"));
    mocks.__signInWithOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: null });

    await expect(
      requestEmailOtpCode("sergei@zamkovoi.yoga", "Сергей", { hintBudgetMs: 1000, responseBudgetMs: 1000 }),
    ).resolves.toBeUndefined();
    expect(mocks.__signInWithOtp).toHaveBeenCalled();
  });
});
