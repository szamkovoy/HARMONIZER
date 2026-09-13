/**
 * Present the account cabinet URL in the system browser.
 *
 * iOS expo-web-browser keeps a singleton `WebBrowserSession`. If
 * `SFSafariViewController.present` is attempted while an RN Modal is still
 * dismissing, present never completes: the JS promise hangs, `vcDidPresent`
 * stays false, and every later `openBrowserAsync` resolves `{ type: "locked" }`
 * without showing anything. That is why «Личный кабинет» can die in one dialog
 * and then look dead on Profile / Home / practices as well.
 *
 * Android Custom Tabs have no such lock (`type: "opened"` immediately).
 *
 * Do not `dismissBrowser` before a healthy open — that can hang on a
 * never-presented VC and would close a Safari that is already on screen.
 * Dismiss only after `type: locked`, and never wait on it forever.
 * A pending `openBrowserAsync` (Safari showing *or* hung present) must not
 * freeze JS `opening` flags: after a short probe we return and let a later
 * tap recover via `locked`.
 */
import { Linking, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

export const CABINET_BROWSER_OPEN_OPTIONS: WebBrowser.WebBrowserOpenOptions = {
  createTask: Platform.OS === "android" ? false : undefined,
  showInRecents: true,
  toolbarColor: "#FFFFFF",
  controlsColor: "#111111",
  dismissButtonStyle: "close",
  presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
};

/** `locked` / Android `opened` return immediately; a hung present stays pending. */
const DEFAULT_HANG_PROBE_MS = 120;
/** `dismiss` on a never-presented SFSafari VC may never call completion. */
const DEFAULT_DISMISS_TIMEOUT_MS = 400;

export type CabinetBrowserHost = {
  openBrowserAsync: (
    url: string,
    options?: WebBrowser.WebBrowserOpenOptions,
  ) => Promise<{ type: string }>;
  dismissBrowser: () => Promise<unknown>;
  openUrl: (url: string) => Promise<unknown>;
  platform: string;
  settleAfterUnlockMs?: number;
  hangProbeMs?: number;
  dismissTimeoutMs?: number;
};

const defaultHost: CabinetBrowserHost = {
  openBrowserAsync: (url, options) => WebBrowser.openBrowserAsync(url, options),
  dismissBrowser: () => WebBrowser.dismissBrowser(),
  openUrl: (url) => Linking.openURL(url),
  platform: Platform.OS,
};

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
  if (ms <= 0) return { ok: true, value: await promise };
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ ok: false }), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ ok: true as const, value })), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function dismissStuckSession(host: CabinetBrowserHost): Promise<void> {
  if (host.platform !== "ios") return;
  try {
    await raceTimeout(Promise.resolve(host.dismissBrowser()), host.dismissTimeoutMs ?? DEFAULT_DISMISS_TIMEOUT_MS);
  } catch {
    /* nothing presented, or dismiss on a never-presented VC */
  }
}

export type PresentCabinetBrowserOutcome = {
  recoveredFromLock: boolean;
  usedSystemSafari: boolean;
  /** Present did not resolve quickly — Safari is showing, or the native session hung. */
  assumedOpen?: boolean;
};

async function openOnce(
  host: CabinetBrowserHost,
  url: string,
): Promise<{ type: string } | { type: "assumed_open" }> {
  const pending = host.openBrowserAsync(url, CABINET_BROWSER_OPEN_OPTIONS);
  const raced = await raceTimeout(pending, host.hangProbeMs ?? DEFAULT_HANG_PROBE_MS);
  if (!raced.ok) {
    void pending.catch(() => undefined);
    return { type: "assumed_open" };
  }
  return raced.value;
}

/**
 * Open the cabinet URL, recovering an iOS `locked` Safari session when needed.
 */
export async function presentCabinetBrowser(
  url: string,
  host: CabinetBrowserHost = defaultHost,
): Promise<PresentCabinetBrowserOutcome> {
  let result = await openOnce(host, url);
  if (result.type === "assumed_open") {
    return { recoveredFromLock: false, usedSystemSafari: false, assumedOpen: true };
  }
  if (result.type !== "locked") {
    return { recoveredFromLock: false, usedSystemSafari: false };
  }

  await dismissStuckSession(host);
  await delay(host.settleAfterUnlockMs ?? 350);
  result = await openOnce(host, url);
  if (result.type === "assumed_open") {
    return { recoveredFromLock: true, usedSystemSafari: false, assumedOpen: true };
  }
  if (result.type !== "locked") {
    return { recoveredFromLock: true, usedSystemSafari: false };
  }

  // Last resort on iOS: leave the wedged SFSafari singleton and use Safari.app.
  // Do not use this on Android — Linking.openURL can spawn a new task and kill
  // the Expo activity (see account_web history 2026-07).
  if (host.platform === "ios") {
    await host.openUrl(url);
    return { recoveredFromLock: true, usedSystemSafari: true };
  }
  throw new Error("cabinet browser locked");
}
