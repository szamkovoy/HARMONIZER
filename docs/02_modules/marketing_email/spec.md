---
id: 02_modules/marketing_email/spec
title: Marketing Email Spec
version: 1.8
updated: 2026-07-31
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
    _legacy_web/app/api/webhooks/ses-marketing/route.ts,
    _legacy_web/app/api/_utils/marketingMail.ts,
    _legacy_web/app/api/_utils/emailTransportProfile.ts,
    _legacy_web/app/api/_utils/sesMarketingSend.ts,
    _legacy_web/app/api/_utils/marketingDeliveryEvents.ts,
    _legacy_web/app/api/_utils/emailSegment.ts,
    _legacy_web/app/api/_utils/emailAutomationRunner.ts,
    _legacy_web/app/api/_utils/emailDeliverability.ts,
    _legacy_web/app/api/_utils/resendMarketingApi.ts,
    _legacy_web/app/api/_utils/emailTemplate.ts,
    _legacy_web/app/api/_utils/emailRichHtml.ts,
    scripts/email-optimize-stored-html.mjs,
    _legacy_web/app/unsubscribe/email/route.ts,
    supabase/migrations/20260724200000_marketing_email.sql,
    supabase/migrations/20260727150000_email_automations_b2_c1_c2.sql,
    supabase/migrations/20260727160000_email_deliverability_indexes.sql,
    supabase/migrations/20260728010000_email_automation_step_name.sql,
    supabase/migrations/20260728140000_email_tracking_keys.sql,
    _legacy_web/app/api/admin/email/automations/[id]/steps/[stepId]/copy/route.ts,
    _legacy_web/app/api/email/track/open/route.ts,
    _legacy_web/app/api/email/track/click/route.ts,
    _legacy_web/app/api/_utils/emailFirstPartyTracking.ts,
    docs/04_workspace/email_providers.md,
  ]
---

## 1. Назначение (продукт)

Админские маркетинговые письма. Транспорт выбирается **`EMAIL_MARKETING`** (`RESEND_ZAMKOVOI_*` | `AMAZON_ZAMKOVOI_*` — см. `docs/04_workspace/email_providers.md`). Сейчас по умолчанию **`RESEND_ZAMKOVOI_RU`**. OTP изолирован (`EMAIL_OTP`, edge `send-auth-email`) и **не** использует marketing-ключ.

**Фаза A–D + F (сейчас):** кампании, сегменты, блочный редактор, цепочки B2+C1/C2, user card, **deliverability** + auto-suppress; **F** — уведомления list-first как рассылки (черновик/`sent_at`); списки `/admin/email` и `/admin/notifications` с `?page=&limit=50&user_id=`.

## 2. Публичный контракт

**Админка (`requireAdmin`):**

- Кампании / сегмент / assets / automations / steps — как ранее
- `GET /api/admin/email/campaigns?page=&limit=50&user_id=` — пагинация; `user_id` → кампании с send на контакт пользователя (`email_campaign_sends`)
- **Locale exact-match (рассылки + автоцепочки):** `resolveExactEmailCopy` — только авторский перевод на `contact`/`users.locale`, без fallback на EN/RU. Нет перевода → получатель пропускается (`skipped_locale` у кампании; у шага цепочки — `email_automation_sends.status=skipped` + `advanceEnrollment`, drip продолжается). Перед due-send — `sync_email_contacts_from_users` + приоритет `users.locale` (смена языка mid-chain).
- **Подсчёт получателей рассылки:** `POST /api/admin/email/segment` с телом copy → `count` = send-eligible (`resolveCampaignRecipients`). UI без «примерно». Аудитория: `all_contacts` («Вся база» — все `email_contacts`, в т.ч. без приложения); `all_installed` («Все установившие» — `user_id` после OTP); `include_demo` («Демо» = `trial_expires_at > now()`, как `/admin/users`); `include_new_24h` («Новые 24ч» = `created_at` за сутки); `not_in_harmonizer` (есть `user_id`, `onboarded_at IS NULL`); тарифные чипы (для `free`/«Навигатор» — без активного trial). `email_contains` без чипов ≡ `all_contacts` + фильтр email.
- Карточка пользователя: в истории писем — статус send (delivered/opened/clicked/…); у уведомлений — прочитано/нет.
- **Open/click UX:** `GET /api/email/track/{open,click}` отвечают сразу (GIF / 302), запись события — в `after()`. На send `email-assets` img → `GET /api/email/asset?u=` (edge, Cache-Control 1y); upload `cacheControl=31536000`.
- Карточка пользователя: `active_enrollments` + `POST …/messaging` `cancel_chain` (enrollment → `cancelled`); история sends — имена цепочки/письма/рассылки
- **Автоцепочки × удаление аккаунта:** `wipeUserAccount` вызывает `cancelActiveEmailAutomationsForUser` (все `active` enrollments контакта → `cancelled`) до `deleteUser`. Due-send дополнительно отменяет enrollment, если у контакта `user_id` null (orphan после wipe). **Welcome (`account_registered`):** enroll только после `users.onboarded_at` (мастер Harmonizer) + `auth.email_confirmed_at`; `cycle_key` = `onboarded_at`. OTP-only / «Не в гармонизаторе» в welcome не попадают; due-send отменяет enrollment без `onboarded_at`. **Повторная регистрация** с тем же email: skip только при уже **активном** enrollment; `completed`/`cancelled` не блокируют.
- **`sync_email_contacts_from_users`:** только `auth.users` с `email_confirmed_at IS NOT NULL` — неподтверждённый OTP не становится маркетинговым контактом и не входит в «Вся база» / «Все установившие» через app-sync.
- Карточка кампании `/admin/email/[id]`: заголовок «Рассылка»; статус RU (`черновик` / `отправлено · дата`); после send — KPI-карточки, read-only имя/сегмент/контент, без блока «Отправка»; копирование доступно
- Общий UI-фундамент: `EmailListRow`, `EmailDeliveryStats`, `EmailMessageWorkspace`; названия/копии — `emailNaming` (`emailListTitle`, `emailCopyName`) для рассылок и шагов. Письмо цепочки: `name` в GET steps; «Копировать» → `POST …/steps/[stepId]/copy` → редирект на копию (`… (копия)`); delay; `POST …/send` `{test_to}`. «Редактировать»: если название изменено и не сохранено — confirm «Новое название будет сохранено» → save → редактор (рассылка и шаг цепочки).
- Сегмент JSON дополнительно: `account_created_on_or_after|before` (`users.created_at`), `onboarded_on_or_after|before` (`users.onboarded_at`) — границы включительно (≥ / ≤)
- From display name: RU «Сергей Замковой», иначе «Sergei Zamkovoi» (`marketingSenderName`, как OTP); footer unsubscribe 12.5px; block fonts web-safe (system/arial/verdana/georgia/times); блоки: heading/text/image/button (legacy `logo` → `image` при parse)
- Preview (`EmailInlinePreview`) = iframe с тем же `wrapMarketingEmailHtml` (колонка 560px), что уходит в Resend. Высота iframe = высота контента (collapse → measure outer table); не сохраняет высоту от предыдущего/длинного письма. `normalizeEmailBodyHtml`: у `<p>` margin 0; пустой абзац = одна пустая строка; `<br>` без доп. интервала. **Save:** `sanitizeEmailRichHtml` / `sanitizeEmailBlocks` чистят paste-bloat (class, Apple/Word font longhands) в `blocks_i18n` + `html_body` — preview ≈ send. Новое изображение по умолчанию `240px`, не `100%`. У `<img>` — integer `width`/`height` (из `naturalWidth`/`naturalHeight` блока или probe при `prepareMarketingEmailHtml` на send).
- Список `/admin/email/automations`: в карточке цепочки шаги показывают **`name`** (`emailListTitle`), не тему.
- `GET /api/admin/email/deliverability?days=7|30|90` — KPI, series, recent problems (с `user_id` / `display_name`), Resend suppressions, статус tracking домена; KPI bounce подписан «Не доставлено»
- `POST /api/admin/email/deliverability` — `{action:"suppress"|"unsuppress", email?}`
- UI: `/admin/email/deliverability` (метрики + просмотр Resend list; без sync на GET); цифры статусов подписки (>0) → `/admin/email/contacts?status=`
- `GET /api/admin/email/contacts?status=` — список контактов по `marketing_status` (до 200)
- **Open/click:** first-party пиксель `GET /api/email/track/open` + редирект `GET /api/email/track/click` (Resend tracking на `.ru` недоступен). Ключи в `email_tracking_keys`. Bounce/complaint — webhook провайдера (Resend и/или SES).
- Cron daily `20 5 * * *` → `invoke_sync_email_suppressions` → `/api/cron/email-suppressions-sync` — Resend suppressions → `email_contacts` **только если** `EMAIL_MARKETING` = Resend; иначе skip. Жёсткий отказ/спам — сразу через webhook.

**Send:** `sendMarketingEmail()` → Resend или SES по `EMAIL_MARKETING`; provider message id пишется в `resend_id`.

**Webhooks**

- `POST /api/webhooks/resend-marketing` — Resend Svix/Bearer (`RESEND_MARKETING_WEBHOOK_SECRET`).
- `POST /api/webhooks/ses-marketing?token=` — SES via SNS (`SES_MARKETING_WEBHOOK_SECRET`); SubscriptionConfirmation supported.
- OTP (from `@zamkovoi.yoga` / subject «sign-in code» / «код входа») на Resend webhook **игнорируется** — тот же аккаунт Resend может слать OTP; в marketing deliverability не пишется.
- `GET …/deliverability` при агрегации тоже отфильтровывает исторические OTP-события по from/subject.

Оба пути → `applyMarketingDeliveryEvent` (общие счётчики кампаний/шагов + local suppress). Match по `resend_id` (= Resend id или SES MessageId).

| Event (Resend / SES) | Действие |
| --- | --- |
| sent / Send | send status |
| delivered / Delivery | `delivered_count` |
| opened/clicked / Open/Click | counters (обычно first-party) |
| bounced Permanent / Bounce Permanent | `bounced_count` + local suppressed (+ Resend suppressions API if Resend) |
| bounced Transient + subType MailboxFull | `bounced_count` + local suppressed (маркетинг стоп; OTP не трогаем) |
| bounced Transient (прочее) | bounce counter, **no** suppress |
| complained / Complaint | `complained_count` + local complained |

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
