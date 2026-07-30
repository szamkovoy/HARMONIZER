/**
 * Verify Firebase App Check tokens (Play Integrity / App Attest / debug).
 * Uses Google's verifyAppCheckToken API with a service-account access token.
 *
 * Env:
 * - FIREBASE_PROJECT_ID (default harmonizer-777)
 * - FIREBASE_SERVICE_ACCOUNT_JSON — full service account JSON string
 * - OTP_APP_CHECK_DEBUG_SECRET — optional shared secret for Expo/Test when
 *   native App Check is unavailable (APP_VARIANT non-production only on client)
 */

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

type VerifyResult =
  | { ok: true; appId: string }
  | { ok: false; reason: string };

let cachedAccess:
  | { token: string; expiresAtMs: number }
  | null = null;

function projectId(): string {
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    "harmonizer-777"
  );
}

function parseServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function signJwtRs256(
  header: Record<string, string>,
  payload: Record<string, string | number>,
  privateKeyPem: string,
): Promise<string> {
  const { createSign } = await import("crypto");
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${data}.${b64url(sig)}`;
}

async function getAccessToken(): Promise<string | null> {
  const sa = parseServiceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.expiresAtMs > Date.now() + 60_000) {
    return cachedAccess.token;
  }
  const assertion = await signJwtRs256(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    console.error("appCheck: token exchange failed", await res.text());
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  cachedAccess = {
    token: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

/** Shared-secret bypass for Expo/Test builds (not a substitute for App Check in store). */
export function verifyOtpDebugAttestation(secretFromClient: string | undefined): boolean {
  const expected = process.env.OTP_APP_CHECK_DEBUG_SECRET?.trim();
  if (!expected || !secretFromClient) return false;
  return secretFromClient === expected;
}

export async function verifyFirebaseAppCheckToken(
  appCheckToken: string | undefined,
): Promise<VerifyResult> {
  const token = (appCheckToken ?? "").trim();
  if (!token) return { ok: false, reason: "missing_token" };

  const access = await getAccessToken();
  if (!access) {
    return { ok: false, reason: "server_not_configured" };
  }

  const pid = projectId();
  // Google currently serves verifyAppCheckToken on v1beta (v1 returns HTML 404).
  const url = `https://firebaseappcheck.googleapis.com/v1beta/projects/${encodeURIComponent(pid)}:verifyAppCheckToken`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ appCheckToken: token }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.warn("appCheck: verify failed", res.status, detail.slice(0, 300));
    return { ok: false, reason: "invalid_token" };
  }
  const data = (await res.json()) as {
    appId?: string;
    token?: { app_id?: string; appId?: string };
  };
  const appId = data.appId || data.token?.appId || data.token?.app_id || "unknown";
  return { ok: true, appId };
}

export function appCheckServerConfigured(): boolean {
  return Boolean(parseServiceAccount());
}
