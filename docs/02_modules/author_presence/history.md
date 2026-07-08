---
id: 02_modules/author_presence/history
title: Author Presence History
version: 1.3
updated: 2026-07-08
depends_on: [02_modules/subscription/spec, 02_modules/admin_panel/spec]
code_refs: [supabase/migrations/20260708120000_stories_storage.sql, supabase/migrations/20260708130000_posts_comments.sql]
---

## Decision Log

- **2026-07-08 (2):** Публикации реализованы end-to-end (этап 2 админ-панели). Решения: существующая таблица `announcements` не переиспользована (баннерная модель, не лента статей — кандидат на депрекацию); `comments` — единая полиморфная таблица `('post','webinar')` без FK на цель, чтобы этап 3 переиспользовал её под вопросы к вебинарам (лайк = голос), целостность держат админ-роуты; тело публикации — plain text, клиент линкует URL (`linkify.ts`, тест на хвостовую пунктуацию); имена комментаторов недоступны под RLS users → security definer RPC `get_target_comments` (+`get_posts_feed` со счётчиком); `display_name` в RPC nullable — русский фолбэк 'Гость' из SQL убран follow-up-миграцией `20260708131000`, локализованный фолбэк на клиенте (i18n-инвариант); обложки — бакет `post-covers` (20 МБ, только изображения), `/api/admin/uploads` научился параметру `bucket`; вкладка «Публикации» без тарифного гейта; заглушка `AnnouncementBanner` на главной заменена живым `LatestPostBanner`. Известный грабель: embed `users` из `comments` требует явного `users!comments_user_id_fkey` (двусмысленность через `comment_likes`) — поймано E2E-смоуком.

- **2026-07-08:** Сторис реализованы end-to-end (этап 1 админ-панели). Решения: медиа — Supabase Storage, бакет `story-media` (public read, лимит 200 МБ, загрузка из админки по signed upload URL напрямую в Storage — мимо лимита тела Vercel); `stories.kind` расширен значением `video` (прямой файл, воспроизведение без внешнего хостинга), легаси `video_cover` сохранён; видео на клиенте — `expo-av` `Video` (без `expo-video`, чтобы не пересобирать dev-клиент); `caption` = jsonb `{text}`, авторский контент без перевода; тарифного гейта нет — сторис видны всем. Реализовано: `modules/stories` (RPC `get_user_stories` + upsert `user_story_views`, `StoriesRing` на главной, `StoryViewerModal` с прогрессом/тап-навигацией), админ-CRUD `/admin/stories` (+`/api/admin/stories*`, `/api/admin/uploads`), миграция `20260708120000_stories_storage.sql`, ключи `stories.*` в i18n-каталоге (8 локалей). Дефолт `expires_at = publish_at + 24h` закреплён юнит-тестом `storyPayload.test.ts`. Удаление сторис чистит и файлы бакета.

- **2026-05:** Модуль зафиксирован в документации как **запланированный**; миграция-заглушка для закрытия Волны 3. В БД заложены сущности под сторис и баннеры, клиентского модуля нет.
