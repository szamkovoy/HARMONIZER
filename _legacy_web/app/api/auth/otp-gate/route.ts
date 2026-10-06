/**
 * OTP send gate: verify App Check (or debug attestation) + issue single-use permit.
 * Client must call this before signInWithOtp; send-auth-email consumes the permit.
 */
import {
  appCheckServerConfigured,
  verifyFirebaseAppCheckToken,
  verifyOtpDebugAttestation,
} from "../../_utils/appCheckVerify";
import { isRetryableOtpPermitError } from "../../_utils/otpPermitRetry";
import { createServiceSupabase, json } from "../../_utils/supabase";

export const runtime = "nodejs";
/** Two 6s permit attempts + App Check budget must finish before the platform kills the isolate. */
export const maxDuration = 25;

const PERMIT_ATTEMPTS = 2;
const PERMIT_TIMEOUT_MS = 6_000;
const PERMIT_RETRY_DELAY_MS = 400;

type Body = {
  email?: string;
  appCheckToken?: string;
  /** Expo/Test only — must match OTP_APP_CHECK_DEBUG_SECRET */
  debugAttestation?: string;
};

type LimitRow = {
  ok?: boolean;
  code?: string;
  retry_after_seconds?: number;
  permit_id?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorPayload(code: string, retryAfterSeconds?: number, status = 429) {
  return json(
    {
      ok: false,
      code,
      ...(typeof retryAfterSeconds === "number"
        ? { retry_after_seconds: retryAfterSeconds }
        : {}),
    },
    { status },
  );
}

export async function POST(req: Request) {
  try {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ ok: false, code: "invalid_json" }, { status: 400 });
    }

    const email = (body.email ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorPayload("invalid_email", undefined, 400);
    }

    // Default false until Firebase App Check is wired + store build shipped;
    // set OTP_REQUIRE_APP_CHECK=true on Vercel + Supabase edge secrets to enforce.
    const requireAppCheck =
      (process.env.OTP_REQUIRE_APP_CHECK ?? "false").trim().toLowerCase() === "true";

    let appId: string | null = null;
    const debugOk = verifyOtpDebugAttestation(body.debugAttestation);
    if (debugOk) {
      appId = "debug-attestation";
    } else if (body.appCheckToken?.trim()) {
      if (!appCheckServerConfigured()) {
        if (requireAppCheck) {
          console.error("otp-gate: FIREBASE_SERVICE_ACCOUNT_JSON missing");
          return errorPayload("app_check_unavailable", undefined, 503);
        }
      } else {
        // Enforce is off by default. A hung Google call must not eat the
        // Vercel budget and turn into a bare 504 before the permit exists.
        let verified: { ok: true; appId: string } | { ok: false; reason: string };
        try {
          verified = await verifyFirebaseAppCheckToken(body.appCheckToken);
        } catch (e) {
          console.warn("otp-gate: app check verify threw", e);
          verified = { ok: false, reason: "timeout" };
        }
        if (!verified.ok) {
          if (requireAppCheck) {
            const unavailable =
              verified.reason === "server_not_configured" || verified.reason === "timeout";
            return errorPayload(
              unavailable ? "app_check_unavailable" : "app_check_failed",
              undefined,
              unavailable ? 503 : 401,
            );
          }
        } else {
          appId = verified.appId;
        }
      }
    } else if (requireAppCheck) {
      // No token and no debug attestation — client App Check not ready / missing.
      console.warn("otp-gate: app_check_missing", { email });
      return errorPayload("app_check_missing", undefined, 401);
    }

    const db = createServiceSupabase({ fetchTimeoutMs: PERMIT_TIMEOUT_MS });
    let data: unknown = null;
    let error: { message?: string; code?: string } | null = null;
    for (let attempt = 0; attempt < PERMIT_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(PERMIT_RETRY_DELAY_MS);
      const result = await db.rpc("otp_issue_send_permit", {
        p_email: email,
        p_app_id: appId,
        p_ttl_seconds: 180,
      });
      data = result.data;
      error = result.error;
      if (!error) break;
      console.error("otp-gate: issue permit", { attempt, email, message: error.message });
      if (!isRetryableOtpPermitError(error) || attempt + 1 >= PERMIT_ATTEMPTS) break;
    }
    if (error) {
      return json({ ok: false, code: "server_error" }, { status: 503 });
    }

    const row = (data ?? {}) as LimitRow;
    if (!row.ok) {
      const status = row.code === "invalid_email" ? 400 : 429;
      return errorPayload(row.code ?? "denied", row.retry_after_seconds, status);
    }

    return json({
      ok: true,
      code: "ok",
      permit_id: row.permit_id,
      expires_in_seconds: 180,
    });
  } catch (e) {
    console.error("otp-gate", e);
    return json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
