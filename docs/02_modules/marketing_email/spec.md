---
id: 02_modules/marketing_email/spec
title: Marketing Email Spec
version: 1.26
updated: 2026-09-15
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
    _legacy_web/app/api/cron/email-welcome/route.ts,
    _legacy_web/app/api/cron/email-campaigns/route.ts,
    _legacy_web/app/api/_utils/emailCampaignSend.ts,
    _legacy_web/app/api/_utils/emailCampaignWarmup.ts,
    _legacy_web/app/api/admin/email/campaigns/[id]/halt/route.ts,
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
    _legacy_web/app/api/_utils/emailUnsubscribe.ts,
    _legacy_web/app/api/_utils/emailUnsubscribeCopy.ts,
    _legacy_web/app/api/_utils/emailTemplate.ts,
    _legacy_web/app/api/_utils/emailRichHtml.ts,
    scripts/email-optimize-stored-html.mjs,
    _legacy_web/app/unsubscribe/route.ts,
    _legacy_web/app/unsubscribe/email/route.ts,
    _legacy_web/app/api/unsubscribe/route.ts,
    supabase/migrations/20260724200000_marketing_email.sql,
    supabase/migrations/20260914132243_email_contacts_delete_with_user.sql,
    supabase/migrations/20260912120000_email_automation_welcome_realtime.sql,
    supabase/migrations/20260912102150_email_automation_pause_freeze.sql,
    supabase/migrations/20260727150000_email_automations_b2_c1_c2.sql,
    supabase/migrations/20260727160000_email_deliverability_indexes.sql,
    supabase/migrations/20260728010000_email_automation_step_name.sql,
    supabase/migrations/20260728140000_email_tracking_keys.sql,
    _legacy_web/app/api/admin/email/automations/[id]/steps/[stepId]/copy/route.ts,
    _legacy_web/app/api/email/track/open/route.ts,
    _legacy_web/app/api/email/track/click/route.ts,
    _legacy_web/app/api/_utils/emailFirstPartyTracking.ts,
    docs/04_workspace/email_providers.md,
    supabase/migrations/20260915184713_email_campaign_waves.sql,
  ]
---

## 1. Назначение (продукт)

Админские маркетинговые письма. Транспорт выбирается **`EMAIL_MARKETING`** (`RESEND_ZAMKOVOI_*` | `AMAZON_ZAMKOVOI_*` — см. `docs/04_workspace/email_providers.md`). Сейчас по умолчанию **`RESEND_ZAMKOVOI_RU`**. OTP изолирован (`EMAIL_OTP`, edge `send-auth-email`) и **не** использует marketing-ключ.

**Фаза A–D + F (сейчас):** кампании, сегменты, блочный редактор, цепочки B2+C1/C2, user card, **deliverability** + auto-suppress; **F** — уведомления list-first как рассылки (черновик/`sent_at`); списки `/admin/email` и `/admin/notifications` с `?page=&limit=50&user_id=` + infinite scroll в UI.

## 2. Публичный контракт

**Админка (`requireAdmin`):**

- Кампании / сегмент / assets / automations / steps — как ранее
- `GET /api/admin/email/campaigns?page=&limit=50&user_id=` — пагинация (UI — infinite scroll); `user_id` → кампании с send на контакт пользователя (`email_campaign_sends`)
- **Locale exact-match (автоцепочки):** `resolveExactEmailCopy` — только авторский перевод на `contact`/`users.locale`, без fallback на EN/RU. Нет перевода → шаг пропускается (`email_automation_sends.status=skipped` + `advanceEnrollment`, drip продолжается). Перед due-send — `sync_email_contacts_from_users` + приоритет `users.locale` (смена языка mid-chain).
- **Locale рассылок (временная заглушка):** `resolveCampaignEmailCopy` (send / segment / test) + `MARKETING_CAMPAIGN_FORCE_COPY_LOCALE = "ru"` в `emailCopy.ts` — кампания шлёт русскую копию всем, независимо от `users.locale`. Счётчик `skipped_locale` из‑за языка не растёт. Снять: константа → `null` — `resolveCampaignEmailCopy` снова = exact-match как у цепочек.
- **Подсчёт получателей рассылки:** `POST /api/admin/email/segment` с телом copy → `count` = send-eligible (`resolveCampaignRecipients`); пустое письмо (`isEmailCopyEmpty`) → `copy_empty: true`, `count` = размер сегмента, `skipped_locale_count=0` (не «все без перевода»). UI без «примерно». Разрешение сегмента — SQL RPC `email_segment_resolve` (`p_mode=count|list`, миграция `20260915122437`): один round-trip, join `email_contacts`×`users`, list как jsonb (обход PostgREST `max_rows=1000`). Превью **не** вызывает `sync_email_contacts_from_users` (только `sync: true`); sync остаётся на send / due-runner. Legacy-fallback: `fetchAllPostgrestRows` по 1000, если RPC ещё не задеплоен. Аудитория: `all_contacts` («Вся база» — все `email_contacts`, в т.ч. импорт Геткурса); `all_installed` («Все установившие» — `user_id` после OTP); `include_demo` («Демо» = `trial_expires_at > now()`, как `/admin/users`); `include_new_24h` («Новые 24ч» = `created_at` за сутки); `not_in_harmonizer` (есть `user_id`, `onboarded_at IS NULL`, **не** email-only импорт); `email_only` («Только рассылки» = `crm_imported_at` + нет `onboarded_at`/`last_seen_at`); тарифные чипы (для `free`/«Навигатор» — без активного trial и без email-only). Доп. фильтры UI: `locales` (язык профиля), last_seen days (вход в приложение), даты регистрации в системе / в Гармонизаторе (`account_created_*` требуют связанный `users` ряд — контакты без аккаунта выпадают). `email_contains` без чипов ≡ `all_contacts` + фильтр email.
- Карточка пользователя: в истории писем — статус send (delivered/opened/clicked/…); у уведомлений — прочитано/нет.
- **Open/click UX:** `GET /api/email/track/{open,click}` отвечают сразу (GIF / 302), запись события — в `after()`. На send `email-assets` img → `GET /api/email/asset?u=` (edge, Cache-Control 1y); upload `cacheControl=31536000`.
- Карточка пользователя: `active_enrollments` + `POST …/messaging` `cancel_chain` (enrollment → `cancelled`); история sends — имена цепочки/письма/рассылки
- **Автоцепочки × удаление аккаунта:** `wipeUserAccount` вызывает `cancelActiveEmailAutomationsForUser` (все `active` enrollments контакта → `cancelled`) до `deleteUser`. `email_contacts.user_id` → `users(id)` **ON DELETE CASCADE** (`20260914132243`) — контакт рассылки удаляется вместе с аккаунтом, не остаётся в «Вся база». Due-send не шлёт, если контакта уже нет / `user_id` пуст (страховка). **Welcome (`account_registered`):** enroll после первого `users.onboarded_at` (мастер Harmonizer) + `auth.email_confirmed_at`; `cycle_key` = `onboarded_at`. OTP-only / «Не в гармонизаторе» в welcome не попадают; due-send отменяет enrollment без `onboarded_at`. Событие — trigger `trg_users_onboarded_email_welcome` → `POST /api/cron/email-welcome` (письмо 1 сразу, delay 0); страховка — `run_email_automations_every_5m`. **Предпроверка инвокера (`20260914130000`):** `invoke_run_email_automations` вызывает Vercel безусловно на тиках :00/:15/:30/:45 (enroller-фазы welcome-safety-net / C1 / C2 — задержки суточного масштаба), а на промежуточных 5-минутных тиках — только если есть `active` enrollment с `next_step_at <= now()` у активной непаузированной автоматизации (сюда входят и retry после сбоя send). Так due-письма и retry сохраняют 5-минутный SLA, а фон Vercel→PostgREST падает с 288 до ~96 запусков/сутки при отсутствии due-работы. Полный `sync_email_contacts_from_users` на welcome не гоняется (только `sync_email_contact_for_user`). **Пауза:** выключение ставит `paused_at` и не отменяет active enrollments / не шлёт due. Включение сдвигает `next_step_at` активных enrollments на длительность паузы (оставшееся ожидание до следующего письма сохраняется), затем `activated_at=now`, `paused_at=null` — новые события во время паузы не догоняются (welcome / C1 / C2). C1 срабатывает в `periodEnd+3d ≥ activated_at`; C2 в `last_seen|created+14d ≥ activated_at`. Сбой send — retry через 5 мин, до 5 попыток, затем шаг пропускается. **Повторная регистрация** с тем же email: skip при **активном** enrollment или том же `cycle_key`; иначе новый цикл.
- **`sync_email_contacts_from_users`:** только `auth.users` с `email_confirmed_at IS NOT NULL` — неподтверждённый OTP не становится маркетинговым контактом и не входит в «Вся база» / «Все установившие» через app-sync. Upsert пишет **только изменившиеся** строки (`ON CONFLICT … WHERE … IS DISTINCT FROM`), `updated_at` бампается лишь при фактическом изменении; `upserted` в ответе = число реально записанных строк, а не размер базы.
- Карточка кампании `/admin/email/[id]`: заголовок «Рассылка»; статус RU (`черновик` / `отправка…` / `пауза` / `отправлено · дата` / `ошибка`); KPI после первых accepts; блок «Прогрев волнами» + кнопка волны / «Остановить» / «Снять автозапуск» (пока не `sent`); копирование доступно
- Общий UI-фундамент: `EmailListRow`, `EmailDeliveryStats`, `EmailMessageWorkspace`; названия/копии — `emailNaming` (`emailListTitle`, `emailCopyName`) для рассылок и шагов. Письмо цепочки: `name` в GET steps; «Копировать» → `POST …/steps/[stepId]/copy` → редирект на копию (`… (копия)`); delay; `POST …/send` `{test_to}`. «Редактировать»: если название изменено и не сохранено — confirm «Новое название будет сохранено» → save → редактор (рассылка и шаг цепочки).
- Сегмент JSON дополнительно: `account_created_on_or_after|before` (`users.created_at`), `onboarded_on_or_after|before` (`users.onboarded_at`) — границы включительно (≥ / ≤)
- From display name: RU «Сергей Замковой», иначе «Sergei Zamkovoi» (`marketingSenderName`, как OTP); footer unsubscribe 14px; chrome/body **Arial 16px / line-height 24px**. Центр: `td align=center` + table `width:100%;max-width:560px;table-layout:fixed` (без `min-width:100%`). `-webkit-text-size-adjust:none`; `word-break:break-word` / `overflow-wrap:anywhere` на td/p (длинный URL не раздувает канву). Ссылка «отписаться» в футере — `white-space:nowrap` (Яндекс iOS иначе режет слово). Preheader: `max-width:0`, без `&zwnj;`/`nowrap`. Без MSO `width=560` (Яндекс iOS иногда читает условные комментарии). На `<p>` инлайн 16px + `<font size="3">`. Блоки: heading/text/image/button (legacy `logo` → `image` при parse)
- **Прогрев волнами:** разовые рассылки не шлют весь сегмент за один клик. `warmup_plan.sizes` по умолчанию `[500,500,1000,1000,2000,2000,3000]` (`repeat_last` → дальше 3000). Получатели сортируются по `greatest(users.last_seen_at, users.getcourse_last_activity_at)`. `audience_cap` (опционально; PATCH) ограничивает письмо N самыми свежими навсегда. `GET …/campaigns/[id]` отдаёт `progress` (`queued`/`accepted`/`failed`/`remaining_estimate`/`next_wave_*`/`halted`); UI poll 5 с пока `sending`. `POST …/send` `{start_wave:true}` (default) → `sending` + drain в `after()` + cron `*/5` `/api/cron/email-campaigns` (pg_net 300s); ответ сразу `{started,status:"sending",…}` без финальных счётчиков волны. Статусы: `draft` → `sending` → `paused` (можно править текст/сегмент/`audience_cap`) → автоследующая волна в ближайшие **16:00 Europe/Moscow** не раньше чем через 12 ч. `POST …/halt` останавливает очередь / снимает автозапуск; повторный send не трогает `sent|delivered|opened|clicked`. `failed` можно ретраить следующей волной. Lease `send_lease_until` + RPC `try_lock_email_campaign_send` не дают двум воркерам слать одно письмо. Пока `sending` — UI read-only + «Остановить». Когда eligible кончились — `sent`.
- **Отписка (публично, без логина):** персональный токен на `email_contacts.unsubscribe_token` (24 байта hex). URL `EMAIL_PUBLIC_BASE_URL/unsubscribe?t=` HMAC-подписывается, если задан `EMAIL_UNSUBSCRIBE_SECRET`. Алиасы: `/unsubscribe/email`, `/api/unsubscribe`; query `t` или `token`. GET — сразу `marketing_status=unsubscribed` (запись не удаляется) + страница «Вы отписаны» / «Я больше не буду отправлять вам подобные письма.» на языке контакта (8 локалей); POST — RFC 8058 One-Click (`List-Unsubscribe=One-Click`), ответ `200 OK` без подтверждения в браузере. Цепочки `active` → `cancelled`. В теле письма: `{{unsubscribe_url}}` и кнопки с надписью «Отписаться»/Unsubscribe/… привязываются к персональной ссылке при send; клик по отписке **не** идёт в first-party click tracking. Send (Resend и SES) всегда шлёт `List-Unsubscribe` + `List-Unsubscribe-Post`. Выборка получателей кампании всегда только `marketing_status=active` (отписавшиеся / bounce / spam-complaint не получают писем).
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

**Публично:** unsubscribe (`GET|POST /unsubscribe`, `/unsubscribe/email`, `/api/unsubscribe`) · webhook.

## 3. Данные

Tables as in B2 + indexes on `email_events(created_at)`, `(event_type, created_at)`.

`email_campaigns` (`20260915184713`): status CHECK включает `paused`; колонки `warmup_plan`, `warmup_wave_index`, `next_wave_at`, `next_wave_size`, `audience_cap`, `send_halted_at`, `send_lease_until`; индексы due (`sending`/`paused`) и `email_campaign_sends` queued; RPC `try_lock_email_campaign_send` / `unlock_email_campaign_send` (service_role); cron job `run_email_campaigns_every_5m` → `invoke_run_email_campaigns`.

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
