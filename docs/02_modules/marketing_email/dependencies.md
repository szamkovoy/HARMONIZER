---
id: 02_modules/marketing_email/dependencies
title: Marketing Email Dependencies
version: 1.0
updated: 2026-07-27
depends_on: [02_modules/admin_panel/spec, 02_modules/infra/spec]
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
- **`infra`** — Supabase tables/storage, Vercel env (`RESEND_ZAMKOVOI_RU_API_KEY`, webhook secret, `CRON_SECRET`, `EMAIL_PUBLIC_BASE_URL`, `EMAIL_UNSUBSCRIBE_SECRET` для подписи track-токенов), Resend (send + webhooks + Suppressions/Domains API); first-party open/click на том же публичном origin; pg_cron → `invoke_run_email_automations` → Vercel `/api/cron/email-automations`; daily `invoke_sync_email_suppressions` → `/api/cron/email-suppressions-sync`.
- **`i18n`** — 8 content locales; exact copy per contact locale; admin translate (`type=post` reuse for subject/body HTML).
- **`profile` / auth** — `email_contacts.user_id` → `users`; `auth.users.email_confirmed_at` для welcome; `skip_email_automations` / `last_seen_at` / `display_name`.
- **`subscription` / payments** — C1 via `payment_contracts` / `payments.paid_until` / `membership_*` (любой paid tier); сегмент «Демо» читает `users.trial_expires_at` (как admin access-now).
- **`notifications`** — user-card push через `segment=user:<id>`.

## 2. От него зависят

- **`admin_panel`** — карточка пользователя читает sends / запускает цепочки.

## 3. Риски

- Смешение ключей yoga/ru ломает изоляцию репутации.
- Webhook без verify secret → spoofed events.
- Массовая синхронная send на Vercel — батчи + `maxDuration`; при росте — очередь.
