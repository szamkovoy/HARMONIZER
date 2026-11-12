import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }) }, Platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({ router: { replace: vi.fn() } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));
vi.mock("@/modules/auth", () => ({ useAuth: () => ({ authUser: null }) }));
vi.mock("@/modules/metrics/core/appOpen", () => ({ logAppOpen: vi.fn() }));
vi.mock("@/modules/notifications/core/pendingPushMessage", () => ({ setPendingPushMessage: vi.fn() }));
vi.mock("@/modules/notifications/core/recordInboxNotification", () => ({ recordInboxNotification: vi.fn() }));
vi.mock("@/modules/notifications/core/pushRegistration", () => ({ registerPushToken: vi.fn() }));
vi.mock("@/services/localNotifications", () => ({ getExpoNotificationsOrNull: () => null }));

import { classifyLastResponse } from "./PushRegistrationBridge";

describe("classifyLastResponse", () => {
  it("returns 'fresh' for a never-handled id", async () => {
    const read = vi.fn().mockResolvedValue(null);
    expect(await classifyLastResponse("abc", read)).toBe("fresh");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("returns 'fresh' when the stored id differs", async () => {
    const read = vi.fn().mockResolvedValue("older-id");
    expect(await classifyLastResponse("abc", read)).toBe("fresh");
  });

  it("returns 'stale' when the stored id matches (Play Store relaunch after update)", async () => {
    const read = vi.fn().mockResolvedValue("abc");
    expect(await classifyLastResponse("abc", read)).toBe("stale");
  });

  it("returns 'fresh' when SecureStore read rejects", async () => {
    const read = vi.fn().mockRejectedValue(new Error("keystore down"));
    expect(await classifyLastResponse("abc", read)).toBe("fresh");
  });
});
