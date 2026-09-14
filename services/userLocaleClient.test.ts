import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMock, eqMock, sessionMock } = vi.hoisted(() => {
  const eqMock = vi.fn(async () => ({ error: null as { message: string } | null }));
  const updateMock = vi.fn(() => ({ eq: eqMock }));
  const sessionMock = vi.fn(async () => ({ user: { id: "u1" } }));
  return { updateMock, eqMock, sessionMock };
});

vi.mock("@/services/supabase", () => ({
  getSupabaseAccessSession: sessionMock,
  requireSupabase: () => ({ from: () => ({ update: updateMock }) }),
}));

import {
  markUserLocaleSynced,
  resetUserLocaleSyncMemo,
  syncUserLocaleToServer,
} from "./userLocaleClient";

describe("syncUserLocaleToServer", () => {
  beforeEach(() => {
    resetUserLocaleSyncMemo();
    updateMock.mockClear();
    eqMock.mockClear();
    eqMock.mockResolvedValue({ error: null });
    sessionMock.mockResolvedValue({ user: { id: "u1" } });
  });

  it("writes once per (user, locale) and again only when the locale changes", async () => {
    await syncUserLocaleToServer("ru");
    await syncUserLocaleToServer("ru");
    await syncUserLocaleToServer("ru");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ locale: "ru" });

    await syncUserLocaleToServer("de");
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith({ locale: "de" });
  });

  it("force bypasses the memo; a failed write is retried next time", async () => {
    await syncUserLocaleToServer("en");
    await syncUserLocaleToServer("en", { force: true });
    expect(updateMock).toHaveBeenCalledTimes(2);

    resetUserLocaleSyncMemo();
    eqMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(syncUserLocaleToServer("fr")).rejects.toBeTruthy();
    await syncUserLocaleToServer("fr");
    expect(updateMock).toHaveBeenCalledTimes(4);
  });

  it("markUserLocaleSynced pre-seeds the memo for a matching profile row; other users still write", async () => {
    markUserLocaleSynced("u1", "it");
    await syncUserLocaleToServer("it");
    expect(updateMock).not.toHaveBeenCalled();

    sessionMock.mockResolvedValue({ user: { id: "u2" } });
    await syncUserLocaleToServer("it");
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
