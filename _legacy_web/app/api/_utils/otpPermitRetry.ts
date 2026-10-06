import { isTimeoutError } from "./monitoring";

/**
 * `otp_issue_send_permit` is safe to retry: a gateway 504 / aborted fetch
 * does not commit, and a second success only replaces the open permit.
 * Ordinary PostgREST writes stay non-retryable in the shared fetch wrapper.
 */
/** Gateway 504 / aborted fetch: the statement did not commit, so a retry is safe. */
export function isRetryableGatewayError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) return false;
  if (isTimeoutError(error)) return true;
  const message = `${error.message ?? ""} ${error.code ?? ""}`;
  return /\b(502|503|504)\b|gateway|fetch failed|network request failed|econnreset|socket/i.test(
    message,
  );
}

export const isRetryableOtpPermitError = isRetryableGatewayError;
