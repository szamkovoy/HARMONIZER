---
id: 04_workspace/email_providers
title: Email providers — OTP vs marketing (Resend ↔ Amazon)
version: 2.0
updated: 2026-07-30
depends_on: [02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/infra/spec, 02_modules/marketing_email/spec]
code_refs:
  [
    supabase/functions/send-auth-email/index.ts,
    supabase/functions/send-auth-email/mail/send.ts,
    supabase/functions/send-auth-email/mail/emailTransportProfile.ts,
    supabase/functions/send-auth-email/mail/providers/resend.ts,
    supabase/functions/send-auth-email/mail/providers/ses.ts,
    _legacy_web/app/api/_utils/emailTransportProfile.ts,
    _legacy_web/app/api/_utils/marketingMail.ts,
    _legacy_web/app/api/_utils/sesMarketingSend.ts,
    _legacy_web/app/api/webhooks/resend-marketing/route.ts,
    _legacy_web/app/api/webhooks/ses-marketing/route.ts,
  ]
---

# Email providers (OTP + marketing)

Operational map for transactional OTP and admin marketing.
**Code is canonical**; this file is the switch / DNS / webhook checklist.

## 1. Channels (must stay separate)

| Channel | Purpose | Env switch | Code entry |
| --- | --- | --- | --- |
| OTP | Sign-in codes (Supabase Send Email Hook) | **`EMAIL_OTP`** (Supabase secrets) | `otp-gate` → `signInWithOtp` → `send-auth-email` (`otp_consume_send_permit`) → `sendMail("auth_otp", …)` |
| Marketing | Admin broadcasts / automations | **`EMAIL_MARKETING`** (Vercel) | `_legacy_web` → `sendMarketingEmail()` |

Reputation on `zamkovoi.ru` must never affect OTP on `zamkovoi.yoga` (and vice versa). Use separate Resend API keys / SES identities per domain.

## 2. Transport profiles (canonical)

Both `EMAIL_OTP` and `EMAIL_MARKETING` accept **exactly one** of:

| Value | Provider | Domain | Resend key env | Default From |
| --- | --- | --- | --- | --- |
| `RESEND_ZAMKOVOI_RU` | Resend | ru | `RESEND_ZAMKOVOI_RU_API_KEY` | `sergei@zamkovoi.ru` |
| `RESEND_ZAMKOVOI_YOGA` | Resend | yoga | `RESEND_ZAMKOVOI_YOGA_API_KEY` | `sergei@zamkovoi.yoga` |
| `AMAZON_ZAMKOVOI_RU` | Amazon SES | ru | — | `sergei@zamkovoi.ru` |
| `AMAZON_ZAMKOVOI_YOGA` | Amazon SES | yoga | — | `sergei@zamkovoi.yoga` |

Display names stay locale-driven (RU «Сергей Замковой» / else «Sergei Zamkovoi»). Optional overrides: `MAIL_FROM_EMAIL`, `MAIL_MARKETING_FROM_EMAIL`.

### Active production defaults (2026-07-30)

```bash
EMAIL_OTP=AMAZON_ZAMKOVOI_YOGA          # Supabase secrets
EMAIL_MARKETING=RESEND_ZAMKOVOI_RU      # Vercel (+ _legacy_web/.env.local)
```

Later (when SES identity + events for `.ru` are ready):

```bash
EMAIL_MARKETING=AMAZON_ZAMKOVOI_RU
```

### Legacy OTP fallback

If `EMAIL_OTP` is unset: `AUTH_EMAIL_PROVIDER=ses|amazon|amazon_ses` → `AMAZON_ZAMKOVOI_YOGA`, else → `RESEND_ZAMKOVOI_YOGA`. Prefer setting `EMAIL_OTP` explicitly.

## 3. Flip commands

### OTP → Amazon (current)

```bash
npx supabase secrets set EMAIL_OTP=AMAZON_ZAMKOVOI_YOGA
# SES_* must already be present
npx supabase functions deploy send-auth-email
```

### OTP back to Resend yoga

```bash
npx supabase secrets set EMAIL_OTP=RESEND_ZAMKOVOI_YOGA
npx supabase secrets set RESEND_ZAMKOVOI_YOGA_API_KEY=<key>
npx supabase functions deploy send-auth-email
```

### Marketing stay on Resend ru (current)

```bash
# Vercel production
npx vercel env add EMAIL_MARKETING production   # value: RESEND_ZAMKOVOI_RU
# RESEND_ZAMKOVOI_RU_API_KEY + RESEND_MARKETING_WEBHOOK_SECRET already set
```

### Marketing → Amazon ru (when ready)

Prerequisites:

1. SES identity `zamkovoi.ru` (+ `sergei@zamkovoi.ru`) verified in production.
2. DNS Easy DKIM / Custom MAIL FROM for `.ru` (mirror yoga §4).
3. SES **Configuration Set** (e.g. `harmonizer-marketing`) with event destination → SNS → HTTPS  
   `https://harmonizer-ten.vercel.app/api/webhooks/ses-marketing?token=<SES_MARKETING_WEBHOOK_SECRET>`  
   Events: send, delivery, bounce, complaint (open/click optional — first-party preferred).
4. Vercel: `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGION`, `SES_CONFIGURATION_SET`, `SES_MARKETING_WEBHOOK_SECRET`, then `EMAIL_MARKETING=AMAZON_ZAMKOVOI_RU`.
5. Deploy `_legacy_web` production.

## 4. Deliverability stats continuity

KPI cards (sent / delivered / opened / clicks / bounce / spam) read **Supabase counters**, not Resend UI.

| Metric | Source | After marketing → Amazon |
| --- | --- | --- |
| Sent | our send path | continues |
| Opened / Clicks | first-party `/api/email/track/*` | continues |
| Delivered / Bounce / Complaint | provider webhook → same counters | historical Resend rows stay; **new** SES events need §3 Configuration Set webhook |
| Resend suppressions list in admin | Resend API | skipped when `EMAIL_MARKETING` is Amazon; local suppress still from SES bounce/complaint |

Provider message id is stored in column `resend_id` (Resend id or SES `MessageId`).

## 5. Resend DNS — `zamkovoi.yoga` (keep while any Resend yoga profile)

| Type | Name | Value (typical) |
| --- | --- | --- |
| TXT | `resend._domainkey` | Resend DKIM public key |
| MX | `send` | `10 feedback-smtp.<region>.amazonses.com` |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |

## 6. Amazon SES DNS — `zamkovoi.yoga` (OTP)

Easy DKIM (three CNAMEs) + Custom MAIL FROM `sesmail.zamkovoi.yoga` — see history / AWS console. Keep while `AMAZON_ZAMKOVOI_YOGA` is used.

## 7. Shared secrets

| Secret | Where | Role |
| --- | --- | --- |
| `EMAIL_OTP` | Supabase | OTP profile |
| `EMAIL_MARKETING` | Vercel | Marketing profile |
| `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` / `SES_REGION` | Supabase + Vercel | Amazon send |
| `SES_CONFIGURATION_SET` | Vercel (marketing) | Attach events to sends |
| `SES_MARKETING_WEBHOOK_SECRET` | Vercel | Auth for `/api/webhooks/ses-marketing?token=` |
| `RESEND_ZAMKOVOI_YOGA_API_KEY` | Supabase | Resend OTP |
| `RESEND_ZAMKOVOI_RU_API_KEY` | Vercel | Resend marketing |
| `RESEND_MARKETING_WEBHOOK_SECRET` | Vercel | Resend Svix / Bearer |
| `SEND_EMAIL_HOOK_SECRET` | Supabase | Auth hook HMAC |
| `MAIL_FROM_EMAIL` / `MAIL_MARKETING_FROM_EMAIL` | optional From overrides |
| `EMAIL_PUBLIC_BASE_URL` / `EMAIL_UNSUBSCRIBE_SECRET` / `EMAIL_TRACKING_SECRET` | Vercel | track + unsubscribe |

## 8. History note (2026-07-17 trap)

Missing SES keys while an old Resend key remained made OTP look like SES but still send via Resend. Always verify a fresh message: Resend → DKIM `s=resend`; SES Easy DKIM → Amazon CNAMEs.
