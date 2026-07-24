---
id: 02_modules/marketing_email/dependencies
title: Marketing Email Dependencies
version: 1.0
updated: 2026-07-25
depends_on: [02_modules/admin_panel/spec, 02_modules/infra/spec]
code_refs:
  [
    _legacy_web/app/api/_utils/marketingMail.ts,
    _legacy_web/app/api/_utils/emailAutomationRunner.ts,
    supabase/migrations/20260724200000_marketing_email.sql,
    supabase/migrations/20260725020000_email_automation_runner.sql,
  ]
---

## 1. Зависит от

- **`admin_panel`** — UI `/admin/email*`, `requireAdmin`, translate API.
- **`infra`** — Supabase tables/storage, Vercel env (`RESEND_ZAMKOVOI_RU_API_KEY`, webhook secret, `CRON_SECRET`), Resend; pg_cron → `invoke_run_email_automations` → Vercel `/api/cron/email-automations`.
- **`i18n`** — 8 content locales; exact copy per contact locale; admin translate (`type=post` reuse for subject/body HTML).
- **`profile` / auth** — link `email_contacts.user_id` → `users` + email from `auth.users`; locale/`country_code`/`membership_*`/`last_seen_at` for segments.
- **`subscription` / payments** — segment filters via `payment_contracts` / `membership_tier`.

## 2. От него зависят

- Нет (Expo client не читает marketing tables в фазе A).

## 3. Риски

- Смешение ключей yoga/ru ломает изоляцию репутации.
- Webhook без verify secret → spoofed events.
- Массовая синхронная send на Vercel — батчи + `maxDuration`; при росте — очередь.
