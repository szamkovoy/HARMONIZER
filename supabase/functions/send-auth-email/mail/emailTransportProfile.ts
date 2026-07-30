/**
 * Mirror of `_legacy_web/app/api/_utils/emailTransportProfile.ts` for Deno edge.
 * Keep values in sync when changing profiles.
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

function isEmailTransportProfileId(raw: string): raw is EmailTransportProfileId {
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

export function resolveOtpTransportProfile(): EmailTransportProfile {
  const explicit = Deno.env.get("EMAIL_OTP")?.trim();
  if (explicit) return parseEmailTransportProfile(explicit, "EMAIL_OTP");
  const legacy = (Deno.env.get("AUTH_EMAIL_PROVIDER") ?? "resend").trim().toLowerCase();
  if (legacy === "ses" || legacy === "amazon" || legacy === "amazon_ses") {
    return PROFILE_MAP.AMAZON_ZAMKOVOI_YOGA;
  }
  return PROFILE_MAP.RESEND_ZAMKOVOI_YOGA;
}
