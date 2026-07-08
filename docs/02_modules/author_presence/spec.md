---
id: 02_modules/author_presence/spec
title: Author Presence Spec
version: 3.0
updated: 2026-07-08
depends_on: [02_modules/subscription/spec, 02_modules/infra/spec, 02_modules/admin_panel/spec, 02_modules/i18n/spec]
code_refs:
  [
    modules/stories/index.ts,
    modules/stories/core/storiesClient.ts,
    modules/stories/ui/StoriesRing.tsx,
    modules/stories/ui/StoryViewerModal.tsx,
    modules/posts/index.ts,
    modules/posts/core/postsClient.ts,
    modules/posts/core/linkify.ts,
    modules/posts/ui/PostsFeedScreen.tsx,
    modules/posts/ui/PostScreen.tsx,
    modules/posts/ui/CommentsSection.tsx,
    modules/posts/ui/LatestPostBanner.tsx,
    app/(tabs)/index.tsx,
    app/(tabs)/posts.tsx,
    app/post/[id].tsx,
    _legacy_web/app/admin/stories/page.tsx,
    _legacy_web/app/admin/posts/page.tsx,
    _legacy_web/app/admin/posts/_components/PostEditor.tsx,
    _legacy_web/app/api/admin/stories/route.ts,
    _legacy_web/app/api/admin/stories/[id]/route.ts,
    _legacy_web/app/api/admin/stories/storyPayload.ts,
    _legacy_web/app/api/admin/posts/route.ts,
    _legacy_web/app/api/admin/posts/[id]/route.ts,
    _legacy_web/app/api/admin/posts/postPayload.ts,
    _legacy_web/app/api/admin/comments/[id]/route.ts,
    _legacy_web/app/api/admin/uploads/route.ts,
    supabase/migrations/20260423080000_init.sql,
    supabase/migrations/20260708120000_stories_storage.sql,
    supabase/migrations/20260708130000_posts_comments.sql,
    services/supabase-types.ts,
    services/communicator-client.ts,
  ]
---

## 1. Назначение (продукт)

Присутствие автора в продукте. Реализовано: **сторис** (фото/видео на 24 часа, кольцо на главной — Instagram-паттерн) и **публикации** (статьи с обложкой, комментариями и лайками комментариев; вкладка «Публикации» + анонс новейшей на главной). Вебинары — этап 3 плана админ-панели.

## 2. Публичный контракт

**Клиент (`modules/stories`, barrel `index.ts`):**

- **`StoriesRing`** — горизонтальное кольцо сторис на главной (`app/(tabs)/index.tsx`, сразу после `HomeHeader`). Загружает данные на фокусе экрана (`useFocusEffect`), рендерит `null`, когда непросмотренных сторис нет. Кружок: превью медиа, фиолетовая рамка `#9B5BEB` (как аватар в шапке) → серую после просмотра в текущей сессии.
- **`StoryViewerModal`** — полноэкранный вьюер: сегменты прогресса, тап вправо/влево, авто-переход (фото 5 с; видео — по окончании, прогресс от плеера `expo-av` `Video`). Легаси `kind='video_cover'` показывается статичной обложкой.
- **`fetchUserStories(userId): Promise<StoryItem[]>`** — RPC `get_user_stories` (только непросмотренные: свежие, либо ≤3 истёкших при паузе публикаций >3 дней). `StoryItem`: `id`, `kind`, `imageUrl/coverUrl/videoUrl`, `captionText` (из `caption.text`), `isFresh`.
- **`markStoryViewed(userId, storyId, completed)`** — upsert в `user_story_views` под RLS «только своё»; `completed=true` при досмотре.

**Клиент (`modules/posts`, barrel `index.ts`):**

- **`PostsFeedScreen`** — вкладка «Публикации» (`app/(tabs)/posts.tsx`, между «Практики» и «Профиль», без тарифного гейта). Карточки: обложка 16:9, заголовок, дата (Luxon, активная локаль) + счётчик комментариев (`tCount`). Pull-to-refresh, перезагрузка на фокусе.
- **`PostScreen`** — экран публикации (`app/post/[id].tsx`, stack): обложка, заголовок, дата, тело через **`LinkifiedBody`** (plain text; URL кликабельны — `splitBodyIntoSegments` в `core/linkify.ts` не захватывает хвостовую пунктуацию), ниже — `CommentsSection`.
- **`CommentsSection`** — переиспользуемый блок комментариев к цели `('post'|'webinar')`: список (имя, относительное время, лайк ♥ с оптимистичным апдейтом, удаление своих с confirm), поле ввода (≤2000 симв.). На вебинарах лайк = голос за вопрос.
- **`LatestPostBanner`** — анонс новейшей публикации на главной (заменил захардкоженную заглушку `AnnouncementBanner`); `null`, пока публикаций нет. Этап 3 добавит приоритет вебинарного анонса.
- **`postsClient.ts`**: `fetchPostsFeed` (RPC `get_posts_feed`), `fetchComments` (RPC `get_target_comments`), `addComment`/`deleteOwnComment`/`setCommentLike` — прямые запросы под RLS.

**Админка (гейт `requireAdmin`, см. `admin_panel`):**

- `GET/POST /api/admin/stories` — список всех (включая черновики/истёкшие, ≤200) / создание. Payload нормализуется `storyPayload.ts`: **`expires_at = publish_at + 24h` по умолчанию**, `caption` → `{text}`, `kind: 'image'|'video'`.
- `PATCH/DELETE /api/admin/stories/[id]` — частичное обновление (публикация/снятие, подпись, сроки, `order_hint`) / удаление строки **вместе с файлами** в `story-media` (пути извлекаются из public-URL).
- `POST /api/admin/uploads` — signed upload URL в бакет `story-media` (`createSignedUploadUrl`, service role); браузер грузит файл напрямую в Storage (`uploadToSignedUrl`, anon-клиент), минуя лимит тела Vercel. Ответ: `{path, token, publicUrl}`.
- UI `/admin/stories`: форма (файл → превью, подпись, «Опубликовать сразу»/датой, «Бессрочная») + список карточек со статусом (Черновик / Запланирована / Активна / Истекла), toggle публикации, удаление с confirm.
- `GET/POST /api/admin/posts` — список всех публикаций (≤200, включая черновики, со счётчиком комментариев) / создание (`postPayload.ts`: заголовок обязателен; `published_at = now()` при `is_published` без явной даты).
- `GET/PATCH/DELETE /api/admin/posts/[id]` — публикация + все комментарии (включая скрытые, embed `users!comments_user_id_fkey(display_name)`) / частичное обновление (`published_at` проставляется при первом включении публикации) / удаление вместе с комментариями (полиморфная связь — без FK) и обложкой в `post-covers`.
- `PATCH/DELETE /api/admin/comments/[id]` — модерация: скрыть/показать (`{is_hidden}`) / удалить безвозвратно.
- `POST /api/admin/uploads` принимает `{bucket: 'story-media'|'post-covers', contentType}` (у `post-covers` только изображения, 20 МБ).
- UI `/admin/posts`: список карточек → `/admin/posts/[id]` (редактор `PostEditor`: обложка, заголовок, textarea, toggle публикации, удаление) + `/admin/posts/new`; под редактором — модерация комментариев (скрыть/показать/удалить).

## 3. Данные

- **`stories`** (init-миграция): `kind` расширен миграцией `20260708120000` до `('image','video','video_cover')`; `video` = прямой файл из Storage в `video_url` (+опц. `cover_url`-постер), `video_cover` — легаси-обложка с внешним хостингом. `caption` jsonb `{text}` — **авторский контент, не переводится** (не UI-строка).
- **`user_story_views`** — PK `(user_id, story_id)`, `completed`; RLS self-all.
- **Storage `story-media`** (public read, 200 МБ/файл, mime: jpeg/png/webp/gif/mp4/mov/webm): объекты `YYYY-MM-DD/<uuid>.<ext>`; policies: public select, admin write (запись фактически через service role).
- RPC **`get_user_stories`** не менялась — `kind` проходит сквозь неё как text.
- **`posts`** (`20260708130000`): `title`, `body` (plain text: переносы + URL), `cover_url`, `is_published`, `published_at`, `created_by`; RLS: public read опубликованных (`published_at <= now()`), admin write. Индекс `published_at desc where is_published`.
- **`comments`** — единая полиморфная таблица (`target_type in ('post','webinar')`, `target_id` без FK; целостность — на серверных роутах админки): `body` ≤2000, `is_hidden`. RLS: authenticated read (скрытые видит только автор), insert/delete своих, admin all.
- **`comment_likes`** — PK `(comment_id, user_id)`; RLS: read authenticated, insert/delete своих.
- **Storage `post-covers`** (public read, 20 МБ, только изображения) — по образцу `story-media`.
- RPC **`get_posts_feed(p_limit)`** (security definer) — опубликованные посты + `comment_count` (видимых). RPC **`get_target_comments(p_target_type, p_target_id, p_user_id)`** (security definer) — комментарии с `display_name` (nullable — имена чужих users не читаются под RLS), `like_count`, `liked_by_me`, `is_mine`.

## 4. i18n

UI-строки — ключи `stories.*` и `posts.*` (+`tabs.posts`) в `modules/i18n/catalog/ru.json` (через `useTranslate`/`tc`), синхронизированы на все 8 локалей. Плюрал счётчика — `posts.comments.count.*` через `tCount`. Фолбэк имени комментатора — ключ `posts.comments.anonymous` на клиенте (RPC возвращает `display_name: null`, русский фолбэк в SQL убран миграцией `20260708131000`). Контент (`caption`, тела публикаций, комментарии) остаётся на языке автора.

## 5. Известные ограничения

- Видео проигрывается через `expo-av` `Video` (deprecated в пользу `expo-video`, но не требует пересборки dev-клиента). При переходе на `expo-video` менять только `StoryViewerModal`.
- `announcements` (+RPC) остаются нетронутыми — кандидат на депрекацию (см. `open_questions.md`).
- Отдельного `FeatureKey` нет: сторис видны на всех тарифах.
