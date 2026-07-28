---
id: 02_modules/marketing_email/spec
title: Marketing Email Spec
version: 1.6
updated: 2026-07-28
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
  ]
---

## 1. Назначение (продукт)

Админские маркетинговые письма с домена **`zamkovoi.ru`** (Resend key `RESEND_ZAMKOVOI_RU_API_KEY`).  
OTP на `zamkovoi.yoga` изолирован и **не** использует этот ключ.

**Фаза A–D + F (сейчас):** кампании, сегменты, блочный редактор, цепочки B2+C1/C2, user card, **deliverability** + auto-suppress; **F** — уведомления list-first как рассылки (черновик/`sent_at`); списки `/admin/email` и `/admin/notifications` с `?page=&limit=50&user_id=`.

## 2. Публичный контракт

**Админка (`requireAdmin`):**

- Кампании / сегмент / assets / automations / steps — как ранее
- `GET /api/admin/email/campaigns?page=&limit=50&user_id=` — пагинация; `user_id` → кампании с send на контакт пользователя (`email_campaign_sends`)
- **Locale exact-match (рассылки + автоцепочки):** `resolveExactEmailCopy` — только авторский перевод на `contact`/`users.locale`, без fallback на EN/RU. Нет перевода → получатель пропускается (`skipped_locale` у кампании; у шага цепочки — `email_automation_sends.status=skipped` + `advanceEnrollment`, drip продолжается). Перед due-send — `sync_email_contacts_from_users` + приоритет `users.locale` (смена языка mid-chain).
- **Подсчёт получателей рассылки:** `POST /api/admin/email/segment` с телом copy → `count` = send-eligible (`resolveCampaignRecipients`). UI без «примерно». Аудитория: `all_contacts` («Вся база» — все `email_contacts`, в т.ч. без приложения); `all_installed` («Все установившие» — `user_id` после OTP); тарифы/демо. `email_contains` без чипов ≡ `all_contacts` + фильтр email.
- **Open/click UX:** `GET /api/email/track/{open,click}` отвечают сразу (GIF / 302), запись события — в `after()`. На send `email-assets` img → `GET /api/email/asset?u=` (edge, Cache-Control 1y); upload `cacheControl=31536000`.
- Карточка пользователя: `active_enrollments` + `POST …/messaging` `cancel_chain` (enrollment → `cancelled`); история sends — имена цепочки/письма/рассылки
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
- **Open/click:** Resend custom tracking недоступен для `.ru` (TLS). Считаем first-party: пиксель `GET /api/email/track/open` + редирект `GET /api/email/track/click` (desktop/mobile); ключи в `email_tracking_keys`; события `email.opened` / `email.clicked` в `email_events` (как у webhook). Bounce/complaint — только Resend webhook.
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
