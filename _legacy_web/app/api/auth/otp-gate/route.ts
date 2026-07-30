/**
 * OTP send gate: verify App Check (or debug attestation) + issue single-use permit.
 * Client must call this before signInWithOtp; send-auth-email consumes the permit.
 */
import {
  appCheckServerConfigured,
  verifyFirebaseAppCheckToken,
  verifyOtpDebugAttestation,
} from "../../_utils/appCheckVerify";
import { createServiceSupabase, json } from "../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 15;

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
        const verified = await verifyFirebaseAppCheckToken(body.appCheckToken);
        if (!verified.ok) {
          if (requireAppCheck) {
            return errorPayload(
              verified.reason === "server_not_configured"
                ? "app_check_unavailable"
                : "app_check_failed",
              undefined,
              verified.reason === "server_not_configured" ? 503 : 401,
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

    const db = createServiceSupabase();
    const { data, error } = await db.rpc("otp_issue_send_permit", {
      p_email: email,
      p_app_id: appId,
      p_ttl_seconds: 180,
    });
    if (error) {
      console.error("otp-gate: issue permit", error.message);
      return json({ ok: false, code: "server_error" }, { status: 500 });
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
