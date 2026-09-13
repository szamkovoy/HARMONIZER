import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Linking: { openURL: vi.fn() },
}));

vi.mock("expo-web-browser", () => ({
  openBrowserAsync: vi.fn(),
  dismissBrowser: vi.fn(),
  WebBrowserPresentationStyle: { FULL_SCREEN: "fullScreen" },
}));

import {
  presentCabinetBrowser,
  type CabinetBrowserHost,
} from "./presentCabinetBrowser";

function host(overrides: Partial<CabinetBrowserHost> = {}): CabinetBrowserHost {
  return {
    openBrowserAsync: vi.fn().mockResolvedValue({ type: "cancel" }),
    dismissBrowser: vi.fn().mockRejectedValue(new Error("not open")),
    openUrl: vi.fn().mockResolvedValue(true),
    platform: "ios",
    settleAfterUnlockMs: 0,
    hangProbeMs: 50,
    dismissTimeoutMs: 20,
    ...overrides,
  };
}

describe("presentCabinetBrowser", () => {
  it("opens once when Safari is free and does not dismiss first", async () => {
    const browser = host();
    await presentCabinetBrowser("https://zamkovoi.yoga/cabinet/", browser);
    expect(browser.openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(browser.dismissBrowser).not.toHaveBeenCalled();
    expect(browser.openUrl).not.toHaveBeenCalled();
  });

  it("clears a stuck iOS session, then retries after type=locked", async () => {
    const openBrowserAsync = vi
      .fn()
      .mockResolvedValueOnce({ type: "locked" })
      .mockResolvedValueOnce({ type: "cancel" });
    const dismissBrowser = vi.fn().mockResolvedValue({ type: "dismiss" });
    const browser = host({ openBrowserAsync, dismissBrowser });

    await expect(
      presentCabinetBrowser("https://zamkovoi.yoga/cabinet/?ott=1", browser),
    ).resolves.toMatchObject({ recoveredFromLock: true, usedSystemSafari: false });

    expect(dismissBrowser).toHaveBeenCalled();
    expect(openBrowserAsync).toHaveBeenCalledTimes(2);
    expect(browser.openUrl).not.toHaveBeenCalled();
  });

  it("falls back to Safari.app on iOS when the singleton stays locked", async () => {
    const openBrowserAsync = vi.fn().mockResolvedValue({ type: "locked" });
    const browser = host({ openBrowserAsync, dismissBrowser: vi.fn().mockResolvedValue({}) });

    await expect(
      presentCabinetBrowser("https://zamkovoi.yoga/cabinet/?ott=2", browser),
    ).resolves.toMatchObject({ recoveredFromLock: true, usedSystemSafari: true });

    expect(openBrowserAsync).toHaveBeenCalledTimes(2);
    expect(browser.openUrl).toHaveBeenCalledWith("https://zamkovoi.yoga/cabinet/?ott=2");
  });

  it("does not use Linking on Android after a locked result", async () => {
    const openBrowserAsync = vi.fn().mockResolvedValue({ type: "locked" });
    const browser = host({
      platform: "android",
      openBrowserAsync,
      dismissBrowser: vi.fn().mockResolvedValue({}),
    });

    await expect(presentCabinetBrowser("https://zamkovoi.yoga/cabinet/", browser)).rejects.toThrow(
      /locked/,
    );
    expect(browser.openUrl).not.toHaveBeenCalled();
  });

  it("does not hang JS when dismissBrowser never completes", async () => {
    const openBrowserAsync = vi.fn().mockResolvedValue({ type: "locked" });
    const browser = host({
      openBrowserAsync,
      dismissBrowser: () => new Promise(() => undefined),
      dismissTimeoutMs: 15,
    });

    await expect(
      presentCabinetBrowser("https://zamkovoi.yoga/cabinet/?ott=3", browser),
    ).resolves.toMatchObject({ usedSystemSafari: true });
  });

  it("releases after a hung present instead of awaiting forever", async () => {
    const openBrowserAsync = vi.fn(() => new Promise<{ type: string }>(() => undefined));
    const browser = host({ openBrowserAsync, hangProbeMs: 15 });

    await expect(
      presentCabinetBrowser("https://zamkovoi.yoga/cabinet/?ott=4", browser),
    ).resolves.toMatchObject({ assumedOpen: true, recoveredFromLock: false });
    expect(browser.openUrl).not.toHaveBeenCalled();
  });
});
