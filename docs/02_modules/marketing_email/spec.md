---
id: 02_modules/marketing_email/spec
title: Marketing Email Spec
version: 1.4
updated: 2026-07-27
depends_on: [02_modules/admin_panel/spec, 02_modules/infra/spec, 02_modules/i18n/spec, 02_modules/profile/spec]
code_refs:
  [
    _legacy_web/app/admin/email/page.tsx,
    _legacy_web/app/admin/email/[id]/page.tsx,
    _legacy_web/app/admin/email/automations/page.tsx,
    _legacy_web/app/admin/email/automations/[id]/page.tsx,
    _legacy_web/app/admin/email/automations/[id]/steps/[stepId]/page.tsx,
    _legacy_web/app/admin/email/_components/EmailMessageWorkspace.tsx,
    _legacy_web/app/admin/email/_components/EmailListRow.tsx,
    _legacy_web/app/admin/email/deliverability/page.tsx,
    _legacy_web/app/api/admin/email/deliverability/route.ts,
    _legacy_web/app/api/admin/email/campaigns/route.ts,
    _legacy_web/app/api/admin/email/automations/route.ts,
    _legacy_web/app/api/cron/email-automations/route.ts,
    _legacy_web/app/api/cron/email-suppressions-sync/route.ts,
    supabase/migrations/20260727180000_email_suppressions_sync_cron.sql,
    _legacy_web/app/api/webhooks/resend-marketing/route.ts,
    _legacy_web/app/api/_utils/marketingMail.ts,
    _legacy_web/app/api/_utils/emailSegment.ts,
    _legacy_web/app/api/_utils/emailAutomationRunner.ts,
    _legacy_web/app/api/_utils/emailDeliverability.ts,
    _legacy_web/app/api/_utils/resendMarketingApi.ts,
    _legacy_web/app/api/_utils/emailTemplate.ts,
    _legacy_web/app/unsubscribe/email/route.ts,
    supabase/migrations/20260724200000_marketing_email.sql,
    supabase/migrations/20260727150000_email_automations_b2_c1_c2.sql,
    supabase/migrations/20260727160000_email_deliverability_indexes.sql,
  ]
---

## 1. Назначение (продукт)

Админские маркетинговые письма с домена **`zamkovoi.ru`** (Resend key `RESEND_ZAMKOVOI_RU_API_KEY`).  
OTP на `zamkovoi.yoga` изолирован и **не** использует этот ключ.

**Фаза A–D (сейчас):** кампании, сегменты, блочный редактор, цепочки B2+C1/C2, user card, **deliverability dashboard + auto-suppress** (Resend webhooks + Suppressions/Domains API).

## 2. Публичный контракт

**Админка (`requireAdmin`):**

- Кампании / сегмент / assets / automations / steps — как ранее
- Карточка кампании `/admin/email/[id]`: заголовок «Рассылка»; статус RU (`черновик` / `отправлено · дата`); после send — KPI-карточки, read-only имя/сегмент/контент, без блока «Отправка»; копирование доступно
- Общий UI-фундамент: `EmailListRow` (список рассылок + письма в цепочке), `EmailDeliveryStats`, `EmailMessageWorkspace` (локали / preview / block editor / тест). Письмо цепочки: `/admin/email/automations/[id]/steps/[stepId]` — тот же workspace без сегмента, с delay; `POST …/steps/[stepId]/send` `{test_to}`
- Сегмент JSON дополнительно: `account_created_on_or_after|before` (`users.created_at`), `onboarded_on_or_after|before` (`users.onboarded_at`) — границы включительно (≥ / ≤)
- From display name: RU «Сергей Замковой», иначе «Sergei Zamkovoi» (`marketingSenderName`, как OTP); footer unsubscribe 12.5px; block fonts web-safe (system/arial/verdana/georgia/times); блоки: heading/text/image/button (legacy `logo` → `image` при parse)
- `GET /api/admin/email/deliverability?days=7|30|90` — KPI, series, recent problems (с `user_id` / `display_name`), Resend suppressions
- `POST /api/admin/email/deliverability` — `{action:"suppress"|"unsuppress", email?}`
- UI: `/admin/email/deliverability` (метрики + просмотр Resend list; без sync на GET)
- Cron daily `20 5 * * *` → `invoke_sync_email_suppressions` → `/api/cron/email-suppressions-sync` — Resend suppressions → `email_contacts` (active→suppressed/complained). Жёсткий отказ/спам по-прежнему сразу через webhook.

**Webhooks** `POST /api/webhooks/resend-marketing`:

| Event | Действие |
| --- | --- |
| sent/delivered/opened/clicked | counters + send status |
| delivery_delayed | log only |
| bounced (Permanent) | local `suppressed` + Resend suppressions.add |
| bounced (Transient) | log, **no** suppress |
| complained | local `complained` + Resend suppressions.add |
| failed | log + send failed |
| suppressed / suppression.added | local `suppressed` |
| suppression.removed | local `suppressed`→`active` |

Matched by `resend_id` on `email_campaign_sends` **or** `email_automation_sends`; fallback contact by `to[]` email.

**Публично:** unsubscribe · webhook.

## 3. Данные

Tables as in B2 + indexes on `email_events(created_at)`, `(event_type, created_at)`.

## 4. Roadmap

| Шаг | Содержание |
| --- | --- |
| **A–D** (эта спека) | Кампании + цепочки + deliverability |
| **A2** | CSV-импорт *(отложено)* |
| **E** | Формы подписки сайта |
| **F** | UX push list/create как у писем |

## 5. Ограничения

- Open/click ≈ pixel/link tracking.
- Gmail rarely emits `complained`.
- Resend suppression list is **region-wide** (affects all domains in region).
