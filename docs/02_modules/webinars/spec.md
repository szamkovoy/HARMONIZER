---
id: 02_modules/webinars/spec
title: Webinars Spec
version: 3.5
updated: 2026-07-24
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
2. **Запись** — после `starts_at + 1h` появляется в админке; публикуется как пост `posts.kind='webinar_recording'` и попадает в ленту «Видео» / `LatestPostBanner` как обычная VideoCard (единый объект с видео).

## 2. Публичный контракт

### Клиент (`modules/webinars`)

- **`webinarTiming`**: `WEBINAR_JOIN_GRACE_HOURS = 1`, `isWebinarInJoinWindow`, `isWebinarRecordingTabAvailable`, `formatWebinarBannerWhen`.
- **`WebinarScreen`**: обложка + локализованные title/description; дата/время без года (меньший шрифт) + `(ваш часовой пояс)`; loading — только спиннер; в join-окне — регистрация (гейт `webinar_community`: только **оплаченный** Master; trial/free → `AccountGateDialog` + кабинет) и после записи блок «Вы зарегистрированы» + `join_url` (кнопки «Отменить запись» нет — отмена без возврата денег лишена смысла; Master-регистрация остаётся ручной, разовая оплата вебинара регистрируется вебхуком автоматически); вопросы = тот же `CommentsSection`/`CommentComposer`/`POST /api/comments`, что и у видео (`headingKey`/`hintKey` для copy; композер над клавиатурой как `PostScreen`). После окна — ссылка на запись (`/post/{recordingPostId}` или legacy `recording_url`).
- **`UpcomingWebinarBanner`**: ближайший опубликованный вебинар с `isWebinarInJoinWindow` и **exact** title для UI-локали (`fetchUpcomingWebinar(locale)` + `localizeWebinar`); без перевода локали — скрыт. Текст `formatWebinarBannerWhen · title`.
- **`WebinarsStrip`**: компонент сохранён; во вкладке «Видео» не монтируется — анонсы только на главной, записи — в общей ленте VideoCard.
- **`webinarsClient`**: `fetchUpcomingWebinar`, `fetchWebinars`, `fetchWebinar`, `localizeWebinar`, регистрации.

### Админка

- Список: `GET /api/admin/webinars?limit=&offset=` → `{ webinars, total, … }`, UI — infinite scroll; заголовок = **название записи**, если recording post уже создан, иначе название анонса; один бейдж — «Запись опубликована» если recording published, иначе «Анонс опубликован»/черновик; счётчик комментариев записи XOR вопросов анонса в том же правиле; участники → `/admin/users/{id}`.
- Карточка: вкладки **Анонс** / **Запись**. UI локалей/обложки/«Удалить перевод (XX)»/кнопки Save+Удалить — как у `PostEditor` (языковая полоса с точками наличия перевода, `RefreshCw` «Перевести», лейблы «Заголовок/Текст»). Анонс дополнительно: `starts_at`, `join_url`. Запись: `PUT …/recording`. Чекбокс до первого save — «Опубликовать», после — «Анонс опубликован» / «Запись опубликована».
- Вопросы анонса и комментарии записи — `created_at` ascending (свежие внизу), как в приложении и у видео.

### Данные

- `webinars`: + `cover_url`, `title_i18n`, `description_i18n`, `cover_url_i18n`, `translations_updated_at`; `is_published` = анонс; `recording_url` deprecated; **`start_notified_at`** — после авто-пуша старта (Edge `notify-webinar-start`, см. `notifications`).
- **Авто-пуш старта:** minutely cron → записавшимся с `join_url`, текст на `users.locale` («вебинар начинается» + ссылка). Не вручную из админки.
- `posts.kind` ∈ (`video`, `webinar_recording`), `posts.webinar_id`; unique one recording per webinar.
- RLS + `get_posts_feed`: published `webinar_recording` виден как обычное video (миграция `20260714003000_webinar_recording_feed_like_video.sql`); live `join_url` по-прежнему через регистрацию.
- Вопросы: `comments` `target_type='webinar'`; комментарии записи: `target_type='post'`.

## 3. i18n

Ключи `webinars.*` (в т.ч. `questionsTitle`/`questionsHint`/`questionPlaceholder`, `registeredTitle`/`registeredBody`, `registerPaidCta`). Даты — Luxon + активная локаль. Контент анонса/записи — `*_i18n` + admin translate; `localizeWebinar` = **exact** UI locale (`pickExactLocalizedText`); без перевода локали → баннер/карточка скрыты.

## 4. Легаси

`announcements.kind='webinar'` не используется. `recording_url` читается клиентом только если linked post ещё нет.
