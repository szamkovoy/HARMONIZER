---
id: 02_modules/marketing_email/history
title: Marketing Email History
version: 1.0
updated: 2026-07-24
depends_on: [02_modules/marketing_email/spec]
code_refs: [supabase/migrations/20260724200000_marketing_email.sql]
---

## Decision Log

- **2026-07-25 (B1 + preview + segment filters):** Welcome runner (`emailAutomationRunner` + `/api/cron/email-automations` + cron `40 * * * *`); seed step 24ч. Preview — `EmailInlinePreview` в потоке страницы (высота по контенту, Сегмент сразу под письмом). Сегмент: надёжный parse дней/строк + in-memory email filter; A2 (CSV) отложен.

- **2026-07-25 (segment sync fix):** `sync_email_contacts_from_users` падал без `pgcrypto` → счётчик всегда 0. Фикс + auto-sync при Refresh сегмента; кнопка «Синхр. контакты» убрана с списка. Preview без внутреннего скролла.

- **2026-07-25 (UX light + block editor):** Nav/list «Рассылки»; светлая админка; preview + «Название рассылки» + блочный editor (logo/heading/text/image/button); сегмент chips Демо/тарифы/Все установившие + Refresh count; `name`/`blocks_i18n` columns.

- **2026-07-24 (phase A):** Hybrid: Harmonizer admin = SoT; Resend `zamkovoi.ru` = transport + webhooks. OTP stays on yoga. Contacts + campaigns + exact-locale skip + segment JSON + unsubscribe token + automation table stubs (no runner). Roadmap A2→F in spec §4. Migration applied (`marketing_email`).

## Smoke / ops (фаза A)

1. Vercel: `RESEND_ZAMKOVOI_RU_API_KEY`, `RESEND_MARKETING_WEBHOOK_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET` (optional HMAC), `MAIL_MARKETING_FROM_EMAIL`, optional `EMAIL_PUBLIC_BASE_URL`.
2. Resend: DNS + tracking subdomain на `zamkovoi.ru`; webhook → `/api/webhooks/resend-marketing` (events sent/delivered/opened/clicked/bounced/complained).
3. Админка: «Письма» → Синхр. контакты → draft → Перевести → сегмент → Тест на свой email → counters после webhook.
4. Unsubscribe link в футере → `marketing_status=unsubscribed`; OTP yoga не затронут.
