/**
 * Android Restore Credentials (Zero-Tap Sign-In) — client orchestration.
 *
 * Flow:
 *   • After OTP sign-in → provision restore key (background).
 *   • Cold start without SecureStore session → try restore key before /sign-in.
 *   • Sign-out → revoke server key + clear native credential state.
 */
import * as Application from "expo-application";
import { Platform } from "react-native";

import {
  isRestoreCredentialsNativeSupported,
  nativeClearRestoreCredentialState,
  nativeCreateRestoreCredential,
  nativeGetRestoreCredential,
} from "harmonizer-android-restore-credentials";

import { getSupabaseAccessToken, getSupabaseSessionSnapshot, requireSupabase } from "@/services/supabase";

/** Server revoke + native clear must not block sign-out if Play Services hangs. */
export const RESTORE_CREDENTIAL_REVOKE_BUDGET_MS = 4_000;
const REVOKE_FETCH_TIMEOUT_MS = 2_500;

/** Resolves when `promise` settles or `ms` elapses, whichever is first. Never throws. */
export async function settleWithTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  await Promise.race([
    Promise.resolve(promise).then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
  ]);
}

function apiOrigin(): string {
  const raw =
    process.env.EXPO_PUBLIC_COMMUNICATOR_API_URL?.trim() ||
    process.env.EXPO_PUBLIC_APP_URL?.trim() ||
    "";
  return raw.replace(/\/$/, "");
}

function androidPackageName(): string | null {
  if (Platform.OS !== "android") return null;
  const id = Application.applicationId?.trim();
  return id || null;
}

export function isRestoreCredentialsEnabled(): boolean {
  return Platform.OS === "android" && isRestoreCredentialsNativeSupported();
}

type SessionMintResponse = {
  ok?: boolean;
  access_token?: string;
  refresh_token?: string;
  code?: string;
};

function parseWebAuthnJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

/** Attempt silent sign-in via Restore Credentials on a new/restored device. */
export async function tryRestoreCredentialSignIn(): Promise<boolean> {
  if (!isRestoreCredentialsEnabled()) return false;
  const pkg = androidPackageName();
  const origin = apiOrigin();
  if (!pkg || !origin) return false;

  let optionsRes: Response;
  try {
    optionsRes = await fetch(`${origin}/api/auth/restore-credential/auth/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ androidPackage: pkg }),
    });
  } catch {
    return false;
  }

  if (!optionsRes.ok) return false;
  let optionsPayload: { ok?: boolean; options?: unknown } = {};
  try {
    optionsPayload = (await optionsRes.json()) as typeof optionsPayload;
  } catch {
    return false;
  }
  if (!optionsPayload.ok || !optionsPayload.options) return false;

  const authResponseRaw = await nativeGetRestoreCredential(JSON.stringify(optionsPayload.options));
  if (!authResponseRaw) return false;

  let credential: Record<string, unknown>;
  try {
    credential = parseWebAuthnJson<Record<string, unknown>>(authResponseRaw);
  } catch {
    return false;
  }

  let verifyRes: Response;
  try {
    verifyRes = await fetch(`${origin}/api/auth/restore-credential/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ androidPackage: pkg, credential }),
    });
  } catch {
    return false;
  }

  if (!verifyRes.ok) return false;
  let data: SessionMintResponse = {};
  try {
    data = (await verifyRes.json()) as SessionMintResponse;
  } catch {
    return false;
  }
  if (!data.ok || !data.access_token || !data.refresh_token) return false;

  const supabase = requireSupabase();
  const { error } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (error) {
    console.warn("[auth] restore credential setSession failed", error.message);
    return false;
  }
  return true;
}

/** Create / refresh restore key after successful sign-in. Best-effort, non-blocking. */
export async function provisionRestoreCredential(): Promise<void> {
  if (!isRestoreCredentialsEnabled()) return;
  const pkg = androidPackageName();
  const origin = apiOrigin();
  if (!pkg || !origin) return;

  const token = await getSupabaseAccessToken();
  if (!token) return;

  let optionsRes: Response;
  try {
    optionsRes = await fetch(`${origin}/api/auth/restore-credential/register/options`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ androidPackage: pkg }),
    });
  } catch {
    return;
  }
  if (!optionsRes.ok) return;

  let optionsPayload: { ok?: boolean; options?: unknown } = {};
  try {
    optionsPayload = (await optionsRes.json()) as typeof optionsPayload;
  } catch {
    return;
  }
  if (!optionsPayload.ok || !optionsPayload.options) return;

  let registrationRaw: string;
  try {
    registrationRaw = await nativeCreateRestoreCredential(
      JSON.stringify(optionsPayload.options),
      true,
    );
  } catch (e) {
    console.warn(
      "[auth] restore credential create failed",
      e instanceof Error ? e.message : String(e),
    );
    return;
  }

  let credential: Record<string, unknown>;
  try {
    credential = parseWebAuthnJson<Record<string, unknown>>(registrationRaw);
  } catch {
    return;
  }

  try {
    await fetch(`${origin}/api/auth/restore-credential/register/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ androidPackage: pkg, credential }),
    });
  } catch {
    // Non-fatal — user stays signed in; next launch can retry provisioning.
  }
}

async function revokeRestoreCredentialBestEffort(): Promise<void> {
  const origin = apiOrigin();
  let token: string | null = null;
  try {
    const snapshot = await getSupabaseSessionSnapshot({ allowExpired: true });
    token = snapshot?.access_token?.trim() || null;
  } catch {
    token = null;
  }

  if (origin && token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REVOKE_FETCH_TIMEOUT_MS);
    try {
      await fetch(`${origin}/api/auth/restore-credential/revoke`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
    } catch {
      // Continue with native clear even if server revoke fails.
    } finally {
      clearTimeout(timer);
    }
  }

  await nativeClearRestoreCredentialState();
}

/**
 * Revoke restore key on sign-out (server + native). Best-effort: never throws,
 * and never waits longer than `RESTORE_CREDENTIAL_REVOKE_BUDGET_MS`.
 */
export async function revokeRestoreCredentialOnSignOut(): Promise<void> {
  if (!isRestoreCredentialsEnabled()) return;
  await settleWithTimeout(revokeRestoreCredentialBestEffort(), RESTORE_CREDENTIAL_REVOKE_BUDGET_MS);
}
