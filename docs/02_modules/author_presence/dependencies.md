---
id: 02_modules/author_presence/dependencies
title: Author Presence Dependencies
version: 3.0
updated: 2026-07-08
depends_on: [02_modules/subscription/spec, 02_modules/infra/spec, 02_modules/admin_panel/spec]
code_refs:
  [
    modules/stories/core/storiesClient.ts,
    modules/posts/core/postsClient.ts,
    app/(tabs)/index.tsx,
    app/(tabs)/_layout.tsx,
    _legacy_web/app/api/admin/uploads/route.ts,
    supabase/migrations/20260708120000_stories_storage.sql,
    supabase/migrations/20260708130000_posts_comments.sql,
  ]
---

## 1. Зависит от

- **`infra`** — Supabase: таблицы `stories`/`user_story_views`/`posts`/`comments`/`comment_likes`, RPC `get_user_stories`, `get_posts_feed`, `get_target_comments` (все security definer), Storage-бакеты `story-media` и `post-covers`, RLS. Клиентский singleton `services/supabase.ts`.
- **`admin_panel`** — весь авторский ввод: `/admin/stories`, `/admin/posts` + `/api/admin/{stories,posts,comments,uploads}*` под `requireAdmin`.
- **`i18n`** — ключи `stories.*`, `posts.*`, `tabs.posts` каталога (`useTranslate`/`tCount`); даты — Luxon с активной локалью.
- **auth** — `useAuth().authUser.id` как `p_user_id` RPC, `user_id` просмотров/комментариев/лайков.

## 2. От него зависят

- **`daily_forecast` (главный экран)** — `app/(tabs)/index.tsx` рендерит `StoriesRing` и `LatestPostBanner` (заменил заглушку `AnnouncementBanner`) после `HomeHeader`; оба рендерят `null` без контента.
- **Табы** — `app/(tabs)/_layout.tsx` содержит вкладку `posts` (без тарифного гейта).
- **`communicator`** — только значение `DialogueEntrySource: "stories"` (контекст входа в диалог, UI сторис его пока не использует).

## 3. Контрактные точки риска

- **Форма public-URL Storage**: DELETE-роуты вычленяют путь файла по маркеру `/storage/v1/object/public/<bucket>/` (общий helper `_utils/storageCleanup.ts`) — смена схемы URL сломает очистку файлов (строка при этом удалится).
- **`caption.text`**: клиент и админка согласованы на jsonb `{text}`; другие ключи в `caption` игнорируются.
- **RPC `get_user_stories` отдаёт только непросмотренные** — кольцо «пустеет» после просмотра; редизайн под «серые просмотренные из БД» потребует новой RPC.
- **`kind='video'`** требует `video_url` с прямым файлом; клиентский фильтр отбрасывает записи без воспроизводимого медиа.
- **`comments.target_id` без FK** — удаление публикации обязано удалять комментарии в роуте `DELETE /api/admin/posts/[id]`; прямое удаление строки `posts` мимо роута оставит сирот.
- **Embed `users` из `comments`** двусмысленный (есть путь через `comment_likes`) — в PostgREST-запросах обязательно `users!comments_user_id_fkey`.
- **`get_target_comments.display_name` nullable** — локализованный фолбэк на клиенте; не возвращать русскую строку из SQL.
