---
id: 02_modules/webinars/dependencies
title: Webinars Dependencies
version: 3.1
updated: 2026-07-14
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
- **`author_presence` (posts)** — текст письма о записи хранится как неопубликованный `posts.kind='webinar_recording'` и в ленту не попадает. Ранее опубликованная запись исчезает из ленты при следующей отправке письма.
- **`admin_panel`** — `/admin/webinars*`, `/api/admin/webinars*`, recording upsert route.
- **`infra`** — таблицы `webinars` / `webinar_registrations` / расширенный `posts`.
- **`i18n`** — catalog `webinars.*`, Luxon, announce/recording `*_i18n`. Письмо берёт текст той же локали; если перевода нет — письмо целиком по-русски.
- **`marketing_email`** — приглашение и письмо о записи уходят через `sendMarketingEmail`, минуя фильтр «только active».

## 2. От него зависят

- **`daily_forecast` (Home)** — `UpcomingWebinarBanner` (join-окно до `starts_at+1h`).
- **`author_presence`** — recording cards в общей ленте «Видео» (анонсы на вкладке не показываются).
- **`notifications`** — сегмент `webinar:*` для ручных рассылок; авто-пуш старта (`notify-webinar-start`); `WebinarScreen` → `ensureNotificationPermission("webinar")` (cooldown 3 дн.).

## 3. Риски

- Feed RPC — **security definer**: фильтр published/`published_at` обязан жить в SQL `get_posts_feed`.
- Удаление вебинара должно чистить вопросы (`target_type=webinar`) и linked recording post + его комментарии (нет FK на comments).
- Смена `WEBINAR_JOIN_GRACE_HOURS` меняет баннер на Home и вкладку «Запись» в админке.
