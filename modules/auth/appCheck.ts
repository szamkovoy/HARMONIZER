/**
 * Firebase App Check token for OTP gate.
 * Production: Play Integrity / App Attest via @react-native-firebase/app-check.
 * Expo/Test: debug provider, or EXPO_PUBLIC_OTP_APP_CHECK_DEBUG_SECRET fallback.
 *
 * initializeAppCheck() is sync; native provider finishes in the background.
 * OTP path uses a short budget so a cold Integrity wait does not block send (~8s).
 * Prefetch on sign-in mount so the token is often ready before the tap.
 */
import Constants from "expo-constants";

type AppCheckCredentials = {
  appCheckToken?: string;
  debugAttestation?: string;
};

/** Max wait on the OTP critical path (ms). Beyond this we send without a token. */
const OTP_TOKEN_BUDGET_MS = 1200;

function appVariant(): string {
  const extra = Constants.expoConfig?.extra as { appVariant?: string } | undefined;
  return (
    process.env.APP_VARIANT ||
    extra?.appVariant ||
    process.env.EXPO_PUBLIC_APP_VARIANT ||
    "production"
  )
    .trim()
    .toLowerCase();
}

function isNonStoreVariant(): boolean {
  const v = appVariant();
  return v === "development" || v === "preview" || v === "dev" || v === "test";
}

let appCheckInstance: unknown = null;
let initPromise: Promise<unknown | null> | null = null;
let prefetchPromise: Promise<void> | null = null;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function ensureAppCheck(): Promise<unknown | null> {
  if (appCheckInstance) return appCheckInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getApp } = require("@react-native-firebase/app") as {
        getApp: () => unknown;
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const appCheckMod = require("@react-native-firebase/app-check") as {
        ReactNativeFirebaseAppCheckProvider: new () => {
          configure: (opts: Record<string, unknown>) => void;
        };
        initializeAppCheck: (
          app: unknown,
          opts: { provider: unknown; isTokenAutoRefreshEnabled: boolean },
        ) => unknown;
      };

      const provider = new appCheckMod.ReactNativeFirebaseAppCheckProvider();
      const debug = isNonStoreVariant() || __DEV__;
      provider.configure({
        android: { provider: debug ? "debug" : "playIntegrity" },
        apple: {
          provider: debug ? "debug" : "appAttestWithDeviceCheckFallback",
        },
      });
      appCheckInstance = appCheckMod.initializeAppCheck(getApp(), {
        provider,
        isTokenAutoRefreshEnabled: true,
      });
      return appCheckInstance;
    } catch (e) {
      console.warn("appCheck: native init failed", e);
      return null;
    }
  })();

  return initPromise;
}

type GetTokenFn = (
  instance: unknown,
  forceRefresh?: boolean,
) => Promise<{ token: string }>;

function loadGetToken(): GetTokenFn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getToken } = require("@react-native-firebase/app-check") as {
      getToken: GetTokenFn;
    };
    return getToken;
  } catch {
    return null;
  }
}

async function tryGetToken(
  getToken: GetTokenFn,
  instance: unknown,
  forceRefresh: boolean,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const raced = await Promise.race([
      getToken(instance, forceRefresh).then((r) => r?.token?.trim() || null),
      sleep(timeoutMs).then(() => null),
    ]);
    return raced;
  } catch (e) {
    console.warn("appCheck: getToken failed", e);
    return null;
  }
}

async function getNativeToken(budgetMs: number): Promise<string | null> {
  const started = Date.now();
  const instance = await ensureAppCheck();
  if (!instance) return null;

  const getToken = loadGetToken();
  if (!getToken) return null;

  const remaining = () => Math.max(0, budgetMs - (Date.now() - started));

  // Cached token first (cheap when prefetch warmed the provider).
  const cached = await tryGetToken(getToken, instance, false, Math.min(400, remaining()));
  if (cached) return cached;

  const left = remaining();
  if (left < 80) return null;

  return tryGetToken(getToken, instance, true, left);
}

/** Warm App Check in the background (call on sign-in mount). */
export function prefetchOtpAppCheck(): void {
  if (prefetchPromise) return;
  prefetchPromise = (async () => {
    try {
      await getNativeToken(5000);
    } catch {
      /* ignore */
    }
  })();
}

/** Credentials for POST /api/auth/otp-gate. */
export async function getOtpAppCheckCredentials(): Promise<AppCheckCredentials> {
  const token = await getNativeToken(OTP_TOKEN_BUDGET_MS);
  if (token) return { appCheckToken: token };

  if (isNonStoreVariant() || __DEV__) {
    const secret = process.env.EXPO_PUBLIC_OTP_APP_CHECK_DEBUG_SECRET?.trim();
    if (secret) return { debugAttestation: secret };
  }

  return {};
}
