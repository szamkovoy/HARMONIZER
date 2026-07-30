---
id: 02_modules/marketing_email/history
title: Marketing Email History
version: 1.0
updated: 2026-07-27
depends_on: [02_modules/marketing_email/spec]
code_refs:
  [
    supabase/migrations/20260724200000_marketing_email.sql,
    supabase/migrations/20260727160000_email_deliverability_indexes.sql,
  ]
---

## Decision Log

- **2026-07-30 (OTP noise + MailboxFull suppress):** Resend marketing webhook skips OTP (`@zamkovoi.yoga` / sign-in code subjects). Deliverability report filters the same historically. Transient `MailboxFull` → local suppressed for marketing (OTP send path unchanged). Root cause of «много отказов» у Play-тестеров: OTP MailboxFull, не рассылки.

- **2026-07-30 (EMAIL_MARKETING profiles):** Transport switch `EMAIL_MARKETING` = `RESEND_ZAMKOVOI_*` \| `AMAZON_ZAMKOVOI_*`. Default `RESEND_ZAMKOVOI_RU`. SES send + `POST /api/webhooks/ses-marketing` (SNS) пишут в те же счётчики; `resend_id` = provider message id. Suppressions cron no-op на Amazon. Ops: `docs/04_workspace/email_providers.md`.

- **2026-07-30 (Demo = trial):** Чип «Демо» (`include_demo`) = активный `trial_expires_at`, как в Пользователях/пульсе. Старое «регистрация 24ч» вынесено в чип «Новые 24ч» (`include_new_24h`). «Навигатор» (`free`) не включает активный trial. Только админка/сегмент — доступ в приложении не меняется.

- **2026-07-28 (edit confirms dirty name):** «Редактировать» на рассылке/шаге цепочки: при несохранённом названии — confirm «Новое название будет сохранено», затем save и открытие редактора.

- **2026-07-28 (all_contacts + track after):** Чип «Вся база» (`all_contacts`); «Все установившие» = linked `user_id`. `email_contains` без чипов → вся база. Click/open: redirect/pixel сразу, DB в `after()`. Картинки писем через `/api/email/asset` (Supabase public часто `no-cache`). Убран текст под превью.

- **2026-07-28 (segment count = send):** Счётчик сегмента и confirm отправки — один алгоритм (`resolveCampaignRecipients`); без «примерно». Hint при skipped_locale / no_audience.

- **2026-07-28 (locale exact mid-chain):** Подтверждено: кампании/цепочки без locale-fallback. Harden: sync + `users.locale` перед due-step; skip без перевода → `status=skipped` + advance (цепочка не стопорится).

- **2026-07-28 (letter links + compact KPI):** История на карточке → страница шага цепочки (`…/steps/[stepId]`). `EmailDeliveryStats` компактный как deliverability (без подписей; «Недоставлено»; без «Ошибки»).

- **2026-07-28 (user card enrollments):** Карточка пользователя: список active `email_automation_enrollments` + `cancel_chain`; история sends — имена цепочки/письма/рассылки, не темы.

- **2026-07-28 (HTML sanitize + chain names):** Paste из Pages/Word раздувал `html_body` (~37KB на «Письмо 1»). `sanitizeEmailRichHtml` на Save/paste/blur; backfill `scripts/email-optimize-stored-html.mjs`. Список `/admin/email/automations` показывает `name` шага (`emailListTitle`).

- **2026-07-28 (фаза F + list pagination):** Уведомления как рассылки (list-first / draft). `GET campaigns` — `page`/`limit`/`user_id`. Карточка пользователя: ссылки «Все рассылки/уведомления».

- **2026-07-28 (contacts drill-down):** Доставляемость: убрана подсказка про opens/clicks; статусы подписки (>0) ведут на `/admin/email/contacts?status=`.

- **2026-07-28 (open/click tracking):** Resend не трекает opens/clicks на zamkovoi.ru (нет TLS для tracking subdomain на .ru). First-party пиксель/клики + `email_tracking_keys`. KPI «Отказ доставки» → «Не доставлено» (bounce сервера, не отписка).

- **2026-07-28 (img center):** `display:block` ломал центрирование в почте (`text-align` не действует на block). Снова `inline-block` + link `inline-block`.

- **2026-07-28 (img width fix):** Probe ошибочно читал `max-width:100%` как `width:100%` → картинки растягивались на колонку. Regex только на CSS `width:`; явный px сохраняется.

- **2026-07-28 (img CLS):** В письме картинка без `height` → текст прыгал вниз после загрузки. Блоки хранят natural size; HTML — integer width/height; send через `prepareMarketingEmailHtml` дописывает размеры, если их не было.

- **2026-07-28 (preview height):** Iframe превью не сжимался после длинного письма (scrollHeight = высота фрейма). Collapse → measure outer table → height по контенту.

- **2026-07-28 (step name GET fix):** GET automation не отдавал `steps.name` → UI откатывался к теме. В select добавлен `name`; общая логика `emailNaming` (title/copy) для рассылок и шагов.

- **2026-07-28 (step name + copy):** У письма цепочки — поле «Название» (колонка `name`, список цепочки) и «Копировать» как у рассылки (`… (копия)` в конец цепочки). Миграция `20260728010000`.

- **2026-07-28 (preview = inbox HTML):** Превью — iframe с `wrapMarketingEmailHtml` (560px). Нормализация `<p>`/пустых строк в `normalizeEmailBodyHtml` (без дефолтных margin почтовых клиентов). Дефолт ширины картинки 240px.

- **2026-07-27 (drop logo block):** В редакторе только «Изображение»; старые `type:logo` нормализуются в `image` при parse.

- **2026-07-27 (shared email UI foundation):** Список и редактор писем общие для рассылок и цепочек (`EmailListRow`, `EmailMessageWorkspace`, `EmailDeliveryStats`). Шаг цепочки — отдельная страница как карточка рассылки (без сегмента, с delay + тест). Footer 12.5px; больше web-safe шрифтов.

- **2026-07-27 (campaign UX + segment dates + From):** Карточка «Рассылка» как у уведомлений: RU-статус, KPI после send, read-only + без «Отправка». Сегмент: даты регистрации в системе / в Гармонизаторе (≥/≤). From: Сергей Замковой / Sergei Zamkovoi по locale; footer 11px. OTP уже так же.

- **2026-07-27 (deliverability trim):** Убраны блоки «Домен отправки» и «Откуда чаще отказы» с дашборда (и запросы Domains API).

- **2026-07-27 (suppressions daily cron):** Синхронизация Resend → контакты — суточный cron `sync_email_suppressions_daily` (`20 5 * * *`), не при открытии дашборда. Миграция `20260727180000`.

- **2026-07-27 (auto sync suppressions):** Кнопка «Подтянуть suppressions» убрана (позже заменена на daily cron).

- **2026-07-27 (D UX + stats home):** Дашборд на русском без дубля «разовых рассылок»; проблемы → имя + ссылка на `/admin/users/[id]`; полная статистика в списке/карточке кампаний; счётчики на шагах цепочки (`20260727170000`) + webhook/runner.

- **2026-07-27 (D deliverability + auto-suppress):** Dashboard `/admin/email/deliverability` (KPI 7/30/90д, series, bounce domains, campaigns, Resend domains + suppressions list). Webhook: hard bounce/complaint → local status + Resend `/suppressions`; soft/Transient bounce не suppress; events failed/suppressed/suppression.*. API POST suppress/unsuppress/sync. Indexes `20260727160000`.

- **2026-07-27 (B2 + C1/C2 + user card):** Полный редактор цепочек (`/admin/email/automations/[id]`); triggers `account_registered` / `subscription_expired` (3d) / `inactive` (14d) с episode enrollments; шаблон без header chrome, новый footer, `{{name}}`, system-ui; карточка пользователя — история писем/пушей, send, launch chain, `skip_email_automations`. Миграция `20260727150000`.

- **2026-07-25 (B1 + preview + segment filters):** Welcome runner (`emailAutomationRunner` + `/api/cron/email-automations` + cron `40 * * * *`); seed step 24ч. Preview — `EmailInlinePreview` в потоке страницы (высота по контенту, Сегмент сразу под письмом). Сегмент: надёжный parse дней/строк + in-memory email filter; A2 (CSV) отложен.

- **2026-07-25 (segment sync fix):** `sync_email_contacts_from_users` падал без `pgcrypto` → счётчик всегда 0. Фикс + auto-sync при Refresh сегмента; кнопка «Синхр. контакты» убрана с списка. Preview без внутреннего скролла.

- **2026-07-25 (UX light + block editor):** Nav/list «Рассылки»; светлая админка; preview + «Название рассылки» + блочный editor (logo/heading/text/image/button); сегмент chips Демо/тарифы/Все установившие + Refresh count; `name`/`blocks_i18n` columns.

- **2026-07-24 (phase A):** Hybrid: Harmonizer admin = SoT; Resend `zamkovoi.ru` = transport + webhooks. OTP stays on yoga. Contacts + campaigns + exact-locale skip + segment JSON + unsubscribe token + automation table stubs (no runner). Roadmap A2→F in spec §4. Migration applied (`marketing_email`).

## Smoke / ops (фаза A)

1. Vercel: `RESEND_ZAMKOVOI_RU_API_KEY`, `RESEND_MARKETING_WEBHOOK_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET` (optional HMAC), optional `MAIL_MARKETING_FROM_EMAIL` / `EMAIL_PUBLIC_BASE_URL`. From **name** всегда по locale (не env).
2. Resend: DNS + tracking на `zamkovoi.ru`; webhook → `/api/webhooks/resend-marketing` (sent/delivered/delivery_delayed/opened/clicked/bounced/complained/failed/suppressed/suppression.added/suppression.removed).
3. Админка: «Рассылки» → draft → Перевести → сегмент → Тест → counters; «Deliverability» для KPI и suppressions.
4. Unsubscribe link в футере → `marketing_status=unsubscribed`; OTP yoga не затронут.
