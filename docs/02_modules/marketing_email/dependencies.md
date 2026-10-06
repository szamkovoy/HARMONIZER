---
id: 02_modules/marketing_email/dependencies
title: Marketing Email Dependencies
version: 1.11
updated: 2026-10-06
depends_on: [02_modules/admin_panel/spec, 02_modules/infra/spec, 02_modules/account_web/spec]
code_refs:
  [
    _legacy_web/app/api/_utils/marketingMail.ts,
    _legacy_web/app/api/_utils/emailAutomationRunner.ts,
    _legacy_web/app/api/_utils/emailCampaignAccessWindow.ts,
    _legacy_web/app/api/_utils/emailDeliverability.ts,
    _legacy_web/app/api/_utils/resendMarketingApi.ts,
    _legacy_web/app/api/_utils/emailSegment.ts,
    supabase/migrations/20260724200000_marketing_email.sql,
    supabase/migrations/20260727150000_email_automations_b2_c1_c2.sql,
    supabase/migrations/20260727160000_email_deliverability_indexes.sql,
    supabase/migrations/20260915122437_email_segment_count_rpc.sql,
    supabase/migrations/20260915184713_email_campaign_waves.sql,
    supabase/migrations/20260924201000_email_campaign_access_grants.sql,
    supabase/migrations/20260927153000_record_first_party_email_open.sql,
    supabase/migrations/20261006020000_email_campaign_batch_send.sql,
    _legacy_web/app/api/_utils/emailCampaignSend.ts,
    _legacy_web/app/api/_utils/marketingDeliveryEvents.ts,
  ]
---

## 1. Зависит от

- **`admin_panel`** — UI `/admin/email*`, `/admin/email/automations/*/steps/*`, `/admin/email/deliverability`, `/admin/users/[id]` messaging, `requireAdmin`, translate API.
- **Resend Batch API** — `POST https://api.resend.com/emails/batch` (≤100 писем, заголовок `Idempotency-Key`, ответ `{data:[{id}]}` в порядке запроса; без `tags` — вебхуки матчатся по `resend_id`). Профиль SES — по одному письму.
- **Supabase RPC** (service_role) — `claim_email_campaign_batch`, `finalize_email_campaign_batch`, `apply_email_campaign_delivery` (`20261006020000`); воркер и вебхук больше не пишут в `email_campaigns` / `email_contacts` напрямую на каждое письмо.
- **`infra`** — Supabase tables/storage, Vercel env (`EMAIL_MARKETING`, `RESEND_ZAMKOVOI_*` / `SES_*`, webhook secrets, `CRON_SECRET`, `EMAIL_PUBLIC_BASE_URL`, `EMAIL_UNSUBSCRIBE_SECRET`, `BLOB_READ_WRITE_TOKEN` для новых картинок писем, `DISABLE_EMAIL_OPEN_TRACKING`: `true`/`1`/`yes`/`on` опускает пиксель, `false` или пусто — пиксель в новых письмах), темп рассылки (`CAMPAIGN_BATCH_SIZE` 1–100, по умолчанию 100; `CAMPAIGN_BATCH_GAP_MS` 0–240 000, по умолчанию 120 000; `CAMPAIGN_DB_SLOW_MS` 200–20 000, по умолчанию 1 500 — все необязательные), Resend and/or Amazon SES; first-party click and open pixel unless that flag is on; pg_cron → email-welcome trigger + email-automations every 5m (pg_net timeout 120s) + **email-campaigns every 5m** (pg_net 300s) + suppressions-sync (Resend-only when profile is Resend).
- **`i18n`** — 8 content locales; automations exact copy per contact locale; campaigns temporarily force RU (`MARKETING_CAMPAIGN_FORCE_COPY_LOCALE`); admin translate (`type=post` reuse for subject/body HTML).
- **`profile` / auth** — `email_contacts.user_id` → `users`; welcome enroll по первому `onboarded_at` (+ confirmed); trigger на `users.onboarded_at`; `skip_email_automations` / `last_seen_at` / `display_name`.
- **`account_web`** — `wipeUserAccount` отменяет активные enrollments перед `deleteUser` (`cancelActiveEmailAutomationsForUser`).
- **`subscription` / payments** — C1 via `payment_contracts` / `payments.paid_until` / `membership_*` (любой paid tier); сегмент «Демо» читает `users.trial_expires_at` (как admin access-now). Волна с `access_window_hours` пишет `users.trial_expires_at` или временный `membership_tier=master` и читает `payment_contracts`/`payments`, чтобы не затереть покупку «Мастера» при откате.
- **`notifications`** — user-card push через `segment=user:<id>`.

## 2. От него зависят

- **`admin_panel`** — карточка пользователя читает sends / запускает цепочки.
- **`account_web`** — единый wipe вызывает cancel enrollments из `emailAutomationRunner`.

## 3. Риски

- Смешение ключей yoga/ru ломает изоляцию репутации.
- Webhook без verify secret → spoofed events.
- Compute Nano (Free): непрерывная поштучная отправка ~23 письма/мин валила проект через ~4 ч (2026-09-25, 2026-10-05: pg_cron `job startup timeout`, PostgREST timeouts, auth 504). Лечение — пачки + пауза + тормоз по латентности; темп `CAMPAIGN_BATCH_GAP_MS` не уменьшать без наблюдения за логами.
- `email_events` без sent/delivered: если когда-нибудь понадобится история «когда именно доставлено», её нет — есть только текущий статус строки отправки.
