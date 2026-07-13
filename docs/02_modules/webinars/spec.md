---
id: 02_modules/webinars/spec
title: Webinars Spec
version: 3.0
updated: 2026-07-13
depends_on: [01_foundation/product_model, 02_modules/subscription/spec, 02_modules/author_presence/spec, 02_modules/admin_panel/spec, 02_modules/i18n/spec]
code_refs:
  [
    modules/webinars/index.ts,
    modules/webinars/core/webinarsClient.ts,
    modules/webinars/core/webinarTiming.ts,
    modules/webinars/ui/WebinarScreen.tsx,
    modules/webinars/ui/UpcomingWebinarBanner.tsx,
    modules/webinars/ui/WebinarsStrip.tsx,
    app/webinar/[id].tsx,
    app/(tabs)/index.tsx,
    modules/posts/ui/PostsFeedScreen.tsx,
    _legacy_web/app/admin/webinars/page.tsx,
    _legacy_web/app/admin/webinars/_components/WebinarEditor.tsx,
    _legacy_web/app/api/admin/webinars/route.ts,
    _legacy_web/app/api/admin/webinars/[id]/route.ts,
    _legacy_web/app/api/admin/webinars/[id]/recording/route.ts,
    _legacy_web/app/api/admin/webinars/webinarPayload.ts,
    modules/access/core/features.ts,
    supabase/migrations/20260708140000_webinars.sql,
    supabase/migrations/20260713200000_webinars_announce_recording.sql,
  ]
---

## 1. Назначение (продукт)

Вебинары автора в двух фазах:

1. **Анонс** — дата/время, обложка, i18n-тексты, ссылка на трансляцию, регистрация, блок «Вопросы для обсуждения».
2. **Запись** — после `starts_at + 1h` появляется в админке; публикуется как пост `posts.kind='webinar_recording'` и попадает в ленту «Видео» **только зарегистрированным** на этот вебинар.

## 2. Публичный контракт

### Клиент (`modules/webinars`)

- **`webinarTiming`**: `WEBINAR_JOIN_GRACE_HOURS = 1`, `isWebinarInJoinWindow`, `isWebinarRecordingTabAvailable`.
- **`WebinarScreen`**: обложка + локализованные title/description; в join-окне — регистрация (гейт `webinar_community` / Master) и после записи блок «Вы зарегистрированы» + `join_url`; вопросы (`CommentsSection` `target_type="webinar"`). После окна — ссылка на запись (`/post/{recordingPostId}` или legacy `recording_url`).
- **`UpcomingWebinarBanner`**: ближайший опубликованный вебинар с `isWebinarInJoinWindow` (включая час после старта).
- **`WebinarsStrip`**: upcoming в join-окне + past с доступной записью; past с `recordingPostId` ведёт на `/post/...`.
- **`webinarsClient`**: `fetchUpcomingWebinar`, `fetchWebinars`, `fetchWebinar`, `localizeWebinar`, регистрации.

### Админка

- Список: бейджи «Анонс: …», «Запись: нет/черновик/опубликована»; до конца join-окна — счётчик вопросов, после — комментариев записи; участники → `/admin/users/{id}`.
- Карточка: вкладки **Анонс** / **Запись** (запись после `starts_at+1h`; default = Запись если доступна). Анонс: cover + i18n + translate, `starts_at` (datetime-local пояса админа → timestamptz), `join_url`, `is_published`. Запись: `PUT /api/admin/webinars/[id]/recording` → upsert `posts` (`kind=webinar_recording`, `webinar_id`).
- Вопросы модерируются на вкладке Анонс; комментарии записи — на вкладке Запись.

### Данные

- `webinars`: + `cover_url`, `title_i18n`, `description_i18n`, `cover_url_i18n`, `translations_updated_at`; `is_published` = анонс; `recording_url` deprecated.
- `posts.kind` ∈ (`video`, `webinar_recording`), `posts.webinar_id`; unique one recording per webinar.
- RLS + `get_posts_feed`: `webinar_recording` виден только при строке в `webinar_registrations`.
- Вопросы: `comments` `target_type='webinar'`; комментарии записи: `target_type='post'`.

## 3. i18n

Ключи `webinars.*` (в т.ч. `questionsTitle`, `registeredTitle`/`registeredBody`, `registerPaidCta`). Даты — Luxon + активная локаль. Контент анонса/записи — `*_i18n` + admin translate.

## 4. Легаси

`announcements.kind='webinar'` не используется. `recording_url` читается клиентом только если linked post ещё нет.
