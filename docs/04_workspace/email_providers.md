---
id: 04_workspace/email_providers
title: Email providers — OTP (zamkovoi.yoga) vs marketing (zamkovoi.ru)
version: 1.0
updated: 2026-07-23
depends_on: [02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/infra/spec]
code_refs:
  [
    supabase/functions/send-auth-email/index.ts,
    supabase/functions/send-auth-email/mail/send.ts,
    supabase/functions/send-auth-email/mail/channels.ts,
    supabase/functions/send-auth-email/mail/providers/resend.ts,
    supabase/functions/send-auth-email/mail/providers/ses.ts,
  ]
---

# Email providers (OTP + future marketing)

Operational map for transactional OTP and the future marketing branch.
**Code is canonical**; this file is the cleanup / switch checklist.

## 1. Channels (must stay separate)

| Channel | Purpose | From | Resend API key env | Code entry |
| --- | --- | --- | --- | --- |
| `auth_otp` | Sign-in OTP via Supabase Send Email Hook | `sergei@zamkovoi.yoga` (`MAIL_FROM_EMAIL`) | **`RESEND_ZAMKOVOI_YOGA_API_KEY`** | `sendMail("auth_otp", …)` in `send-auth-email` |
| `marketing` | Admin broadcasts (`marketing_email`) | `sergei@zamkovoi.ru` (`MAIL_MARKETING_FROM_EMAIL`) | **`RESEND_ZAMKOVOI_RU_API_KEY`** | Vercel `_legacy_web/app/api/_utils/marketingMail.ts` (never Auth OTP hook) |

Do **not** reuse the yoga key for marketing or the ru key for OTP.
Reputation (spam / bulk) on `zamkovoi.ru` must never affect OTP deliverability on `zamkovoi.yoga`.

## 2. Active transport switch

| Env | Values | Default |
| --- | --- | --- |
| `AUTH_EMAIL_PROVIDER` | `resend` \| `ses` | `resend` |

```bash
# Current (SES sandbox blocked production recipients) — Resend for OTP:
npx supabase secrets set AUTH_EMAIL_PROVIDER=resend
npx supabase secrets set RESEND_ZAMKOVOI_YOGA_API_KEY=<from .env.local>

# Switch back to Amazon SES after production access is approved:
npx supabase secrets set AUTH_EMAIL_PROVIDER=ses
# SES_* secrets must still be present (see §4 tails)
```

Redeploy is optional after secret-only changes; after code changes:

```bash
npx supabase functions deploy send-auth-email
```

## 3. Resend DNS (active for OTP) — `zamkovoi.yoga`

Added in Resend dashboard when the domain was verified (keep while OTP uses Resend):

| Type | Name | Value (typical) |
| --- | --- | --- |
| TXT | `resend._domainkey` | Resend DKIM public key (`p=MIGf…`) |
| MX | `send` | `10 feedback-smtp.<region>.amazonses.com` (Resend MAIL FROM; region may vary) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |

Resend signs OTP with DKIM selector **`s=resend`** and often uses Return-Path on **`send.zamkovoi.yoga`**.
That is expected for Resend — do **not** confuse with Amazon SES Custom MAIL FROM (`sesmail`).

When removing Resend later: delete the three rows above from DNS **and** unset
`RESEND_ZAMKOVOI_YOGA_API_KEY` / set `AUTH_EMAIL_PROVIDER=ses` (or another provider).

## 4. AMAZON SES DNS tails (keep until SES is abandoned)

These were added ~2026-07-16…17 for SES Easy DKIM + Custom MAIL FROM.
**Leave them in DNS while SES code/secrets remain** so switchback is one secret flip.

### 4.1 Easy DKIM (apex `zamkovoi.yoga`) — three CNAME

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `ezx36odz3ufautxilps5jmzhxxtklf3q._domainkey` | `ezx36odz3ufautxilps5jmzhxxtklf3q.dkim.amazonses.com` |
| CNAME | `oapze4knnhqq72qbelecla2ic2mtt7fq._domainkey` | `oapze4knnhqq72qbelecla2ic2mtt7fq.dkim.amazonses.com` |
| CNAME | `hz46ulv5tnwtp4qx2bkukijomm57xrzn._domainkey` | `hz46ulv5tnwtp4qx2bkukijomm57xrzn.dkim.amazonses.com` |

### 4.2 Custom MAIL FROM — `sesmail.zamkovoi.yoga`

Added after Yandex flagged Return-Path `@eu-west-1.amazonses.com` (must be set on
**both** domain identity `zamkovoi.yoga` and email identity `sergei@zamkovoi.yoga` in SES console).

| Type | Name | Value |
| --- | --- | --- |
| MX | `sesmail` | `10 feedback-smtp.eu-west-1.amazonses.com` |
| TXT | `sesmail` | `v=spf1 include:amazonses.com ~all` |

### 4.3 Not SES (do not delete as “SES cleanup”)

| Record | Belongs to |
| --- | --- |
| `resend._domainkey`, MX/TXT `send` | **Resend** (active OTP) |
| `mail._domainkey`, MX `@` → `mx.yandex.net`, SPF `redirect=_spf.yandex.net` | **Yandex 360** inbound mailbox |
| `getcourse._domainkey`, SPF `gca.to`, CNAME `sergei` → GetCourse | GetCourse |
| `smtp.bz._domainkey`, SPF `spf.smtp.bz`, CNAME `stats` | smtp.bz |

### 4.4 SES secrets / code tails (Supabase)

Keep until you decide to drop Amazon entirely:

- Secrets: `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGION` (`eu-west-1`)
- Code: `supabase/functions/send-auth-email/mail/providers/ses.ts` (marked **AMAZON SES TAIL**)
- Switch: `AUTH_EMAIL_PROVIDER=ses`

**Full SES removal checklist** (only when asked):

1. DNS: delete §4.1 three CNAMEs + §4.2 `sesmail` MX/TXT.
2. Supabase: `npx supabase secrets unset SES_ACCESS_KEY_ID SES_SECRET_ACCESS_KEY SES_REGION` (and drop `ses` from `AUTH_EMAIL_PROVIDER` usage).
3. Code: delete `mail/providers/ses.ts` and the `ses` branch in `mail/send.ts`.
4. AWS: optional — delete IAM user / SES identities / cancel production request.

## 5. Shared secrets (both providers)

| Secret | Role |
| --- | --- |
| `SEND_EMAIL_HOOK_SECRET` | Supabase Auth → edge hook HMAC |
| `MAIL_FROM_EMAIL` | OTP From address (default `sergei@zamkovoi.yoga`) |
| `MAIL_FROM_NAME` | Optional From display-name override |
| `MAIL_MARKETING_FROM_EMAIL` | Marketing From (default `sergei@zamkovoi.ru`) |
| `RESEND_ZAMKOVOI_RU_API_KEY` | Marketing Resend key — **Vercel** production (not OTP edge) |
| `RESEND_MARKETING_WEBHOOK_SECRET` | Verify `POST /api/webhooks/resend-marketing` — Resend Svix `whsec_…` **or** `Authorization: Bearer <secret>` (plain hex OK for phase A) |
| `EMAIL_UNSUBSCRIBE_SECRET` | HMAC for `/unsubscribe/email?t=` tokens |

## 5b. Marketing DNS — `zamkovoi.ru` (ops checklist)

1. Add domain in Resend dashboard (same account or separate — key must be RU key only).
2. Publish DKIM / SPF / MX for Resend on `zamkovoi.ru` (mirror yoga pattern; values from Resend UI).
3. Configure **custom tracking subdomain** (open/click) on `zamkovoi.ru` — avoid shared Resend tracking host.
4. Point webhook to `https://harmonizer-ten.vercel.app/api/webhooks/resend-marketing`.  
   **Events to enable:** `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`.  
   **Skip:** `email.received`, `email.scheduled`, `email.suppressed`, `email.failed`, `suppression.*` (not used by our handler).  
   Put the Resend signing secret (`whsec_…`) into Vercel `RESEND_MARKETING_WEBHOOK_SECRET` (Svix headers).
5. Never put `RESEND_ZAMKOVOI_RU_API_KEY` into OTP-only secrets unless intentionally shared read — prefer Vercel-only for send path.

## 6. History note (2026-07-17 trap)

When switching Resend → SES the first time, OTP still went through Resend because
`RESEND_API_KEY` remained in secrets while SES keys were missing. Headers showed
`DKIM s=resend` and `Return-Path @send.zamkovoi.yoga` even though DNS for Resend
had been removed. Always verify a fresh OTP source: Resend → `s=resend`; SES Easy
DKIM → one of the three tokens in §4.1.
