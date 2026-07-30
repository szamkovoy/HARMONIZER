/**
 * Unified EMAIL_OTP / EMAIL_MARKETING profiles (Resend ↔ Amazon × yoga|ru).
 * Canonical ops: docs/04_workspace/email_providers.md
 */

export const EMAIL_TRANSPORT_PROFILES = [
  "RESEND_ZAMKOVOI_RU",
  "RESEND_ZAMKOVOI_YOGA",
  "AMAZON_ZAMKOVOI_RU",
  "AMAZON_ZAMKOVOI_YOGA",
] as const;

export type EmailTransportProfileId = (typeof EMAIL_TRANSPORT_PROFILES)[number];

export type EmailTransportProvider = "resend" | "amazon";
export type EmailTransportDomain = "ru" | "yoga";

export type EmailTransportProfile = {
  id: EmailTransportProfileId;
  provider: EmailTransportProvider;
  domain: EmailTransportDomain;
  /** Resend API key env name (only when provider=resend). */
  resendApiKeyEnv: "RESEND_ZAMKOVOI_RU_API_KEY" | "RESEND_ZAMKOVOI_YOGA_API_KEY" | null;
  defaultFromEmail: string;
};

const PROFILE_MAP: Record<EmailTransportProfileId, EmailTransportProfile> = {
  RESEND_ZAMKOVOI_RU: {
    id: "RESEND_ZAMKOVOI_RU",
    provider: "resend",
    domain: "ru",
    resendApiKeyEnv: "RESEND_ZAMKOVOI_RU_API_KEY",
    defaultFromEmail: "sergei@zamkovoi.ru",
  },
  RESEND_ZAMKOVOI_YOGA: {
    id: "RESEND_ZAMKOVOI_YOGA",
    provider: "resend",
    domain: "yoga",
    resendApiKeyEnv: "RESEND_ZAMKOVOI_YOGA_API_KEY",
    defaultFromEmail: "sergei@zamkovoi.yoga",
  },
  AMAZON_ZAMKOVOI_RU: {
    id: "AMAZON_ZAMKOVOI_RU",
    provider: "amazon",
    domain: "ru",
    resendApiKeyEnv: null,
    defaultFromEmail: "sergei@zamkovoi.ru",
  },
  AMAZON_ZAMKOVOI_YOGA: {
    id: "AMAZON_ZAMKOVOI_YOGA",
    provider: "amazon",
    domain: "yoga",
    resendApiKeyEnv: null,
    defaultFromEmail: "sergei@zamkovoi.yoga",
  },
};

export function isEmailTransportProfileId(raw: string): raw is EmailTransportProfileId {
  return (EMAIL_TRANSPORT_PROFILES as readonly string[]).includes(raw);
}

export function parseEmailTransportProfile(
  raw: string | null | undefined,
  label: "EMAIL_OTP" | "EMAIL_MARKETING",
): EmailTransportProfile {
  const trimmed = (raw ?? "").trim().toUpperCase();
  if (!trimmed) {
    throw new Error(`${label} is required (one of ${EMAIL_TRANSPORT_PROFILES.join(", ")})`);
  }
  if (!isEmailTransportProfileId(trimmed)) {
    throw new Error(
      `${label}=${JSON.stringify(raw)} is invalid; expected one of ${EMAIL_TRANSPORT_PROFILES.join(", ")}`,
    );
  }
  return PROFILE_MAP[trimmed];
}

/**
 * OTP profile: EMAIL_OTP, or legacy AUTH_EMAIL_PROVIDER + yoga defaults.
 * - AUTH_EMAIL_PROVIDER=ses|amazon → AMAZON_ZAMKOVOI_YOGA
 * - else → RESEND_ZAMKOVOI_YOGA
 */
export function resolveOtpTransportProfile(env: {
  EMAIL_OTP?: string | null;
  AUTH_EMAIL_PROVIDER?: string | null;
}): EmailTransportProfile {
  const explicit = env.EMAIL_OTP?.trim();
  if (explicit) return parseEmailTransportProfile(explicit, "EMAIL_OTP");
  const legacy = (env.AUTH_EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
  if (legacy === "ses" || legacy === "amazon" || legacy === "amazon_ses") {
    return PROFILE_MAP.AMAZON_ZAMKOVOI_YOGA;
  }
  return PROFILE_MAP.RESEND_ZAMKOVOI_YOGA;
}

/** Marketing profile: EMAIL_MARKETING (default RESEND_ZAMKOVOI_RU). */
export function resolveMarketingTransportProfile(env: {
  EMAIL_MARKETING?: string | null;
}): EmailTransportProfile {
  const raw = env.EMAIL_MARKETING?.trim();
  if (!raw) return PROFILE_MAP.RESEND_ZAMKOVOI_RU;
  return parseEmailTransportProfile(raw, "EMAIL_MARKETING");
}
