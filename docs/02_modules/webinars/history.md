---
id: 02_modules/webinars/history
title: Webinars History
version: 3.2
updated: 2026-07-31
depends_on: [02_modules/subscription/spec]
code_refs: [supabase/migrations/20260708140000_webinars.sql]
---

## Decision Log

- **2026-07-31 (trial gated like free):** Запись на вебинар в приложении недоступна на демо-trial — `canUseFeatureForAccess` закрывает `webinar_community`; UI как у «Навигатора» (`AccountGateDialog` → кабинет).

- **2026-07-24 (auto start push):** Авто-уведомление записавшимся в момент `starts_at` (Edge minutely + `start_notified_at`), язык `users.locale`, ссылка `join_url`. Inbox `kind=webinar_start`. См. `notifications/history`.

- **2026-07-19 (9):** `WebinarScreen` — убрана кнопка «Отменить запись» (отмена без возврата денег лишена смысла; для разовой оплаты вебинара регистрация ставится вебхуком Lava автоматически, для Master — ручная «Записаться» без отмены). `toggleRegistration` → `register` (только false→true). Спасибо-модалка за вебинар теперь показывается при возврате из кабинета с **любым** ctx (раньше только `ctx=webinar:<id>`) — см. `account_web`.

- **2026-07-14 (8):** `fetchUpcomingWebinar(locale)` skips announces without exact UI-locale title.

- **2026-07-14 (7):** Admin list title = recording title when recording post exists, else announce; `localizeWebinar` exact locale only.

- **2026-07-14 (6):** `localizeWebinar` uses preferred→en→ru (same as posts/notifications).

- **2026-07-14 (5):** Banner `·` before title; announce date without year + smaller type; Videos tab no longer mounts `WebinarsStrip` (announces only on Home).

- **2026-07-14 (4):** Home banner — `formatWebinarBannerWhen` + title (без «вебинар»); detail — `(ваш часовой пояс)`; loading spinner-only; admin announce questions chronological ascending (не по голосам).

- **2026-07-14 (3):** Admin announce/recording editors match PostEditor locale bar (dots, RefreshCw), field labels, «Удалить перевод (XX)» next to publish, Delete on both tabs.

- **2026-07-14 (2):** Announce questions reuse PostScreen comment stack (docked composer + `CommentsSection` copy props); `/api/comments` background-translates webinar questions when announce has multiple title locales; admin «Удалить перевод» style matches PostEditor.

- **2026-07-14:** Admin list — один бейдж (запись XOR анонс) + matching comment/question count. Cover UX как Video (`h-40` contain; add button / delete link). Publish checkbox «Опубликовать» до первого save. `WebinarsStrip` только upcoming; published recording = ordinary feed/home VideoCard. Миграция `20260714003000_webinar_recording_feed_like_video.sql` снимает registrants-only с ленты (live join по-прежнему через регистрацию).

- **2026-07-13:** Dual model Анонс + Запись. Анонс: cover/i18n на `webinars`, баннер до `starts_at+1h`, вопросы «Вопросы для обсуждения», registered UX + `join_url`. Запись: linked `posts.kind=webinar_recording` + `webinar_id`, admin вкладка после grace, лента/RLS только для `webinar_registrations`. Миграция `20260713200000_webinars_announce_recording.sql`. `recording_url` deprecated.

- **2026-07-08:** Вебинары реализованы end-to-end (этап 3 админ-панели). Решения: новая таблица `webinars` вместо легаси `announcements.kind='webinar'` (баннерная модель не тянет регистрации/записи; announcements — кандидат на депрекацию); вопросы — переиспользование полиморфных `comments` (`target_type='webinar'`) и `comment_likes` как голосов, UI — общий `CommentsSection` из posts; записавшиеся (`webinar_registrations`, PK webinar+user, RLS self) — одновременно будущий сегмент рассылки этапа 4; email для админ-списка записавшихся тянется из auth.users точечными `getUserById` (в `public.users` email нет); запись вебинара гейтится по тарифу Master **клиентски** (`webinar_community` + UpgradeDialog) — `recording_url` остаётся в public-read строке, осознанный компромисс; на главной — отдельный `UpcomingWebinarBanner` над `LatestPostBanner` (а не вытеснение), в «Публикациях» — `WebinarsStrip` с предстоящими и записями. E2E-смоук: create→RLS read→register→question→vote→admin detail (голоса, email)→attach recording→delete (вопросы+регистрации зачищены).

- **2026-05:** Модуль зафиксирован в документации как **запланированный**; миграция выполнена для целостности графа Волны 3. В коде только задел доступа и схема БД под баннеры типа вебинара — отдельного runtime-модуля нет.
