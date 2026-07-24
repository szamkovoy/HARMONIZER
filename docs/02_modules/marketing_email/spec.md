---
id: 02_modules/marketing_email/spec
title: Marketing Email Spec
version: 1.0
updated: 2026-07-25
depends_on: [02_modules/admin_panel/spec, 02_modules/infra/spec, 02_modules/i18n/spec, 02_modules/profile/spec]
code_refs:
  [
    _legacy_web/app/admin/email/page.tsx,
    _legacy_web/app/admin/email/[id]/page.tsx,
    _legacy_web/app/admin/email/automations/page.tsx,
    _legacy_web/app/admin/email/_components/EmailInlinePreview.tsx,
    _legacy_web/app/api/admin/email/campaigns/route.ts,
    _legacy_web/app/api/admin/email/campaigns/[id]/route.ts,
    _legacy_web/app/api/admin/email/campaigns/[id]/send/route.ts,
    _legacy_web/app/api/admin/email/segment/route.ts,
    _legacy_web/app/api/admin/email/assets/route.ts,
    _legacy_web/app/api/admin/email/automations/route.ts,
    _legacy_web/app/api/cron/email-automations/route.ts,
    _legacy_web/app/api/webhooks/resend-marketing/route.ts,
    _legacy_web/app/api/_utils/marketingMail.ts,
    _legacy_web/app/api/_utils/emailSegment.ts,
    _legacy_web/app/api/_utils/emailAutomationRunner.ts,
    _legacy_web/app/api/_utils/emailTemplate.ts,
    _legacy_web/app/unsubscribe/email/route.ts,
    supabase/migrations/20260724200000_marketing_email.sql,
    supabase/migrations/20260725020000_email_automation_runner.sql,
  ]
---

## 1. Назначение (продукт)

Админские маркетинговые письма с домена **`zamkovoi.ru`** (Resend key `RESEND_ZAMKOVOI_RU_API_KEY`).  
OTP на `zamkovoi.yoga` изолирован и **не** использует этот ключ.

**Фаза A + B1 (сейчас):** контакты, разовые кампании (exact locale), сегменты, блочный редактор, inline preview в потоке страницы, отправка батчами, webhooks → статистика, unsubscribe; welcome-цепочка (enroll + delayed send по cron).

## 2. Публичный контракт

**Админка (`requireAdmin`):**

- `GET/POST /api/admin/email/campaigns` — список / создать draft (`name`, `blocks_i18n`, rendered `html_*`)
- `GET/PATCH/DELETE /api/admin/email/campaigns/[id]` — PATCH: `name` / segment / per-locale subject+blocks+html
- `POST /api/admin/email/campaigns/[id]/send` — рассылка eligible контактам
- `POST /api/admin/email/segment` — `{ query }` → `{ count, countries[] }` (счётчик в UI по кнопке Refresh; перед count — sync contacts)
- `POST /api/admin/email/assets` — upload картинки в bucket `email-assets`
- `POST /api/admin/email/contacts/sync` — upsert контактов из app users
- `GET /api/admin/email/automations` · `PATCH /api/admin/email/automations/[id]` (`is_active`)
- `GET|POST /api/cron/email-automations` — `CRON_SECRET` / `x-cron-secret`; enroll welcome + send due steps
- UI: `/admin/email` («Рассылки»), `/admin/email/[id]` (тема → inline HTML письма → Сегмент → Отправка; без fixed-height iframe), `/admin/email/automations`

**Сегмент (chips):** Демо (`users.created_at` за последние 24ч) · Навигатор/Наставник/Мастер · Все установившие (`user_id` not null, exclusive).  
Фильтры: `last_seen_within_days` (был ≤ N дней назад; null last_seen → вне), `last_seen_older_than_days` (не заходил ≥ N дней; null → входит), `email_contains` (подстрока email, case-insensitive).

**Публично:**

- `GET /unsubscribe/email?t=<token>` — opt-out marketing (приложение не трогает)
- `POST /api/webhooks/resend-marketing` — Resend events (shared secret)

**Язык:** как push — exact HTML/subject на `email_contacts.locale`; нет перевода вкладки → skip.

## 3. Данные

- `email_contacts`, `email_campaigns` (+ `name`, `blocks_i18n`), `email_campaign_sends`, `email_events`, `email_assets`
- Заготовки B: `email_automations`, `email_automation_steps`, `email_automation_enrollments`
- Storage: `email-assets` (public read signed/public URL for img src)

## 4. Roadmap (вести по шагам)

| Шаг | Содержание |
| --- | --- |
| **A** | Кампании + сегменты + webhooks + stub цепочек |
| **A2** | CSV-импорт контактов + список Contacts в админке *(отложено)* |
| **B1** (эта спека) | Раннер welcome (`welcome_after_install`): enroll по onboarded/last_seen; шаг 24ч; cron hourly `run_email_automations_hourly` |
| **B2** | Полный UI шагов цепочки (порядок, delay, insert) |
| **C1** | Lifecycle: не продлил подписку |
| **C2** | Lifecycle: неактивен после установки / пропал после активности |
| **D** | Дашборд deliverability + auto-suppress |
| **E** | Формы подписки сайта + locale marker |
| **F** | UX push-уведомлений list/create как у писем |

После завершения текущего шага агент предлагает следующий из таблицы.

## 5. Ограничения

- Open tracking ≈ pixel (не «просмотр в списке почты»).
- Reply в webhook не гарантирован — ответы в Яндекс-ящик.
- Resend Broadcasts/Automations dashboard не редактор кампаний.
- Tracking subdomain на `zamkovoi.ru` — ops (см. `email_providers.md`).
