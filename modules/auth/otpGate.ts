import { getOtpAppCheckCredentials } from "@/modules/auth/appCheck";

export type OtpGateErrorCode =
  | "cooldown"
  | "hourly_limit"
  | "daily_limit"
  | "verify_limit"
  | "app_check_failed"
  | "app_check_missing"
  | "app_check_unavailable"
  | "invalid_email"
  | "no_permit"
  | "server_error"
  | "network";

export class OtpGateError extends Error {
  readonly code: OtpGateErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: OtpGateErrorCode, retryAfterSeconds?: number) {
    super(`otp_gate:${code}`);
    this.name = "OtpGateError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function apiOrigin(): string {
  const raw =
    process.env.EXPO_PUBLIC_COMMUNICATOR_API_URL?.trim() ||
    process.env.EXPO_PUBLIC_APP_URL?.trim() ||
    "";
  return raw.replace(/\/$/, "");
}

type GateResponse = {
  ok?: boolean;
  code?: string;
  retry_after_seconds?: number;
};

/** Call before signInWithOtp — issues single-use send permit after App Check. */
export async function requestOtpSendPermit(email: string): Promise<void> {
  const origin = apiOrigin();
  if (!origin) {
    throw new OtpGateError("server_error");
  }

  const creds = await getOtpAppCheckCredentials();
  let res: Response;
  try {
    res = await fetch(`${origin}/api/auth/otp-gate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        appCheckToken: creds.appCheckToken,
        debugAttestation: creds.debugAttestation,
      }),
    });
  } catch {
    throw new OtpGateError("network");
  }

  let data: GateResponse = {};
  try {
    data = (await res.json()) as GateResponse;
  } catch {
    data = {};
  }

  if (res.ok && data.ok) return;

  const code = (data.code ?? "server_error") as OtpGateErrorCode;
  throw new OtpGateError(code, data.retry_after_seconds);
}
