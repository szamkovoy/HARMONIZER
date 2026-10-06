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

const GATE_ATTEMPTS = 2;
const GATE_TIMEOUT_MS = 12_000;
const GATE_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * RN 0.81 still polyfills AbortSignal from the old `abort-controller` package,
 * which has no static `timeout()`. Node/Vercel have it; the phone does not —
 * calling it throws and the UI shows «Нет соединения с сервером».
 */
function abortSignalAfter(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function isRetryableGateFailure(status: number, code: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return code === "server_error";
}

/** Call before signInWithOtp — issues single-use send permit after App Check. */
export async function requestOtpSendPermit(email: string): Promise<void> {
  const origin = apiOrigin();
  if (!origin) {
    throw new OtpGateError("server_error");
  }

  const creds = await getOtpAppCheckCredentials();
  const body = JSON.stringify({
    email: email.trim().toLowerCase(),
    appCheckToken: creds.appCheckToken,
    debugAttestation: creds.debugAttestation,
  });

  let lastError = new OtpGateError("server_error");
  for (let attempt = 0; attempt < GATE_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(GATE_RETRY_DELAY_MS);
    let res: Response;
    const timeout = abortSignalAfter(GATE_TIMEOUT_MS);
    try {
      res = await fetch(`${origin}/api/auth/otp-gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        signal: timeout.signal,
      });
    } catch {
      lastError = new OtpGateError("network");
      continue;
    } finally {
      timeout.clear();
    }

    let data: GateResponse = {};
    try {
      data = (await res.json()) as GateResponse;
    } catch {
      data = {};
    }

    if (res.ok && data.ok) return;

    const code = (data.code ?? "server_error") as OtpGateErrorCode;
    lastError = new OtpGateError(code, data.retry_after_seconds);
    if (!isRetryableGateFailure(res.status, code)) break;
  }
  throw lastError;
}
