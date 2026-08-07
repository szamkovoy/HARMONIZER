---
id: 02_modules/marketing_email/dependencies
title: Marketing Email Dependencies
version: 1.1
updated: 2026-07-31
depends_on: [02_modules/admin_panel/spec, 02_modules/infra/spec, 02_modules/account_web/spec]
code_refs:
  [
    _legacy_web/app/api/_utils/marketingMail.ts,
    _legacy_web/app/api/_utils/emailAutomationRunner.ts,
    _legacy_web/app/api/_utils/emailDeliverability.ts,
    _legacy_web/app/api/_utils/resendMarketingApi.ts,
    supabase/migrations/20260724200000_marketing_email.sql,
    supabase/migrations/20260727150000_email_automations_b2_c1_c2.sql,
    supabase/migrations/20260727160000_email_deliverability_indexes.sql,
  ]
---

## 1. Зависит от

- **`admin_panel`** — UI `/admin/email*`, `/admin/email/automations/*/steps/*`, `/admin/email/deliverability`, `/admin/users/[id]` messaging, `requireAdmin`, translate API.
- **`infra`** — Supabase tables/storage, Vercel env (`EMAIL_MARKETING`, `RESEND_ZAMKOVOI_*` / `SES_*`, webhook secrets, `CRON_SECRET`, `EMAIL_PUBLIC_BASE_URL`, `EMAIL_UNSUBSCRIBE_SECRET`), Resend and/or Amazon SES; first-party open/click; pg_cron → email-automations + suppressions-sync (Resend-only when profile is Resend).
- **`i18n`** — 8 content locales; exact copy per contact locale; admin translate (`type=post` reuse for subject/body HTML).
- **`profile` / auth** — `email_contacts.user_id` → `users`; sync контактов только после `email_confirmed_at`; welcome enroll по `onboarded_at` (+ confirmed); `skip_email_automations` / `last_seen_at` / `display_name`.
- **`account_web`** — `wipeUserAccount` отменяет активные enrollments перед `deleteUser` (`cancelActiveEmailAutomationsForUser`).
- **`subscription` / payments** — C1 via `payment_contracts` / `payments.paid_until` / `membership_*` (любой paid tier); сегмент «Демо» читает `users.trial_expires_at` (как admin access-now).
- **`notifications`** — user-card push через `segment=user:<id>`.

## 2. От него зависят

- **`admin_panel`** — карточка пользователя читает sends / запускает цепочки.
- **`account_web`** — единый wipe вызывает cancel enrollments из `emailAutomationRunner`.

## 3. Риски

- Смешение ключей yoga/ru ломает изоляцию репутации.
- Webhook без verify secret → spoofed events.
- Массовая синхронная send на Vercel — батчи + `maxDuration`; при росте — очередь.
