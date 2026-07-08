import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const {
  requireSupabaseMock,
  readPersistedAuthSessionFromStorageMock,
  clearPersistedAuthSessionMock,
} = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
  readPersistedAuthSessionFromStorageMock: vi.fn(),
  clearPersistedAuthSessionMock: vi.fn(),
}));

vi.mock("@/services/supabase", () => ({
  requireSupabase: requireSupabaseMock,
  readPersistedAuthSessionFromStorage: readPersistedAuthSessionFromStorageMock,
  clearPersistedAuthSession: clearPersistedAuthSessionMock,
  sessionHasUsableAccessToken: (
    session: { access_token?: string; user?: { id?: string } } | null,
    allowExpired = false,
  ) => {
    if (!session?.access_token || !session.user?.id) return false;
    if (allowExpired) return true;
    return true;
  },
}));

import { recoverAuthSessionFromPersistedStorageWithRetries } from "./bootstrapRecoverSession";

function makeSession(refresh: string, access = "access"): Session {
  return {
    access_token: access,
    refresh_token: refresh,
    user: { id: "user-1" },
  } as Session;
}

describe("recoverAuthSessionFromPersistedStorageWithRetries", () => {
  const setSession = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    setSession.mockReset();
    readPersistedAuthSessionFromStorageMock.mockReset();
    clearPersistedAuthSessionMock.mockReset();
    clearPersistedAuthSessionMock.mockResolvedValue(undefined);
    requireSupabaseMock.mockReturnValue({ auth: { setSession } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns session when setSession succeeds", async () => {
    const disk = makeSession("refresh-a");
    readPersistedAuthSessionFromStorageMock.mockResolvedValue(disk);
    setSession.mockResolvedValue({ data: { session: disk }, error: null });

    const promise = recoverAuthSessionFromPersistedStorageWithRetries();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe(disk);
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(clearPersistedAuthSessionMock).not.toHaveBeenCalled();
  });

  it("retries with rotated refresh token from disk instead of clearing storage", async () => {
    const stale = makeSession("refresh-a", "access-a");
    const rotated = makeSession("refresh-b", "access-b");
    readPersistedAuthSessionFromStorageMock
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(rotated);
    setSession
      .mockResolvedValueOnce({
        data: { session: null },
        error: new Error("Invalid Refresh Token: Refresh Token Not Found"),
      })
      .mockResolvedValueOnce({ data: { session: rotated }, error: null });

    const promise = recoverAuthSessionFromPersistedStorageWithRetries();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe(rotated);
    expect(setSession).toHaveBeenNthCalledWith(1, {
      access_token: "access-a",
      refresh_token: "refresh-a",
    });
    expect(setSession).toHaveBeenNthCalledWith(2, {
      access_token: "access-b",
      refresh_token: "refresh-b",
    });
    expect(clearPersistedAuthSessionMock).not.toHaveBeenCalled();
  });

  it("clears storage only when invalid refresh matches disk token", async () => {
    const dead = makeSession("refresh-dead");
    readPersistedAuthSessionFromStorageMock.mockResolvedValue(dead);
    setSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Invalid Refresh Token: Refresh Token Not Found"),
    });

    const promise = recoverAuthSessionFromPersistedStorageWithRetries();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeNull();
    expect(clearPersistedAuthSessionMock).toHaveBeenCalledTimes(1);
  });

  it("returns null immediately when disk has no session", async () => {
    readPersistedAuthSessionFromStorageMock.mockResolvedValue(null);

    const promise = recoverAuthSessionFromPersistedStorageWithRetries();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeNull();
    expect(setSession).not.toHaveBeenCalled();
  });
});
