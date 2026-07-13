---
id: 02_modules/webinars/dependencies
title: Webinars Dependencies
version: 3.0
updated: 2026-07-13
depends_on: [02_modules/subscription/spec, 02_modules/author_presence/spec, 02_modules/admin_panel/spec]
code_refs:
  [
    modules/webinars/core/webinarsClient.ts,
    modules/webinars/core/webinarTiming.ts,
    modules/webinars/ui/WebinarScreen.tsx,
    modules/access/core/features.ts,
    supabase/migrations/20260708140000_webinars.sql,
    supabase/migrations/20260713200000_webinars_announce_recording.sql,
  ]
---

## 1. Зависит от

- **`subscription`** — `webinar_community` для кнопки записи на анонс (сейчас Master); paywall/checkout — будущая точка расширения.
- **`author_presence` (posts)** — запись вебинара = `posts.kind='webinar_recording'`; лента `get_posts_feed` + RLS registrants-only; `CommentsSection` / `LinkifiedBody` / обложки `post-covers`; admin translate `type=post`.
- **`admin_panel`** — `/admin/webinars*`, `/api/admin/webinars*`, recording upsert route.
- **`infra`** — таблицы `webinars` / `webinar_registrations` / расширенный `posts`.
- **`i18n`** — catalog `webinars.*`, Luxon, announce/recording `*_i18n`.

## 2. От него зависят

- **`daily_forecast` (Home)** — `UpcomingWebinarBanner` (join-окно до `starts_at+1h`).
- **`author_presence`** — `WebinarsStrip` во «Видео»; recording cards в общей ленте.
- **`notifications`** — сегмент `webinar_registrations` для будущих пушей.

## 3. Риски

- Feed RPC — **security definer**: фильтр registrants обязан жить в SQL `get_posts_feed`, не только в RLS.
- Удаление вебинара должно чистить вопросы (`target_type=webinar`) и linked recording post + его комментарии (нет FK на comments).
- Смена `WEBINAR_JOIN_GRACE_HOURS` меняет баннер, вкладку «Запись» и семантику strip одновременно.
