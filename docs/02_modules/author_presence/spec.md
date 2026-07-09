---
id: 02_modules/author_presence/spec
title: Author Presence Spec
version: 3.4
updated: 2026-07-09
depends_on: [02_modules/subscription/spec, 02_modules/infra/spec, 02_modules/admin_panel/spec, 02_modules/i18n/spec]
code_refs:
  [
    modules/stories/index.ts,
    modules/stories/core/storiesClient.ts,
    modules/stories/ui/StoriesRing.tsx,
    modules/stories/ui/StoryViewerModal.tsx,
    modules/stories/ui/StorySessionBootstrap.tsx,
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
    _legacy_web/app/api/admin/stories/process/route.ts,
    _legacy_web/app/api/admin/stories/cleanup/route.ts,
    _legacy_web/app/api/admin/stories/storyPayload.ts,
    _legacy_web/app/api/admin/posts/route.ts,
    _legacy_web/app/api/admin/posts/[id]/route.ts,
    _legacy_web/app/api/admin/posts/postPayload.ts,
    _legacy_web/app/api/admin/comments/[id]/route.ts,
    _legacy_web/app/api/admin/uploads/route.ts,
    supabase/migrations/20260423080000_init.sql,
    supabase/migrations/20260708120000_stories_storage.sql,
    supabase/migrations/20260708200500_stories_media_pipeline_feed_cleanup.sql,
    supabase/migrations/20260708130000_posts_comments.sql,
    services/supabase-types.ts,
    services/communicator-client.ts,
  ]
---

## 1. Назначение (продукт)

Присутствие автора в продукте. Реализовано: **сторис** (фото/видео на 24 часа, кольцо на главной — Instagram-паттерн) и **публикации** (статьи с обложкой, комментариями и лайками комментариев; вкладка «Публикации» + анонс новейшей на главной). Вебинары — этап 3 плана админ-панели.

## 2. Публичный контракт

**Клиент (`modules/stories`, barrel `index.ts`):**

- **`StoriesRing`** — интерактивное кольцо встроено в левый аватар `HomeHeader` (`app/(tabs)/index.tsx`), отдельного блока под шапкой больше нет. На фокусе главной грузит **весь активный feed** (`fetchStoryFeed`) и анимированно раскрывает сегменты по часовой стрелке; непросмотренные сегменты фиолетовые, просмотренные — серые. В центре показывается session-cached `thumbnail_url` последней активной сторис; если сторис нет, рендерится обычный бренд-аватар без интерактивности.
- **`StoryViewerModal`** — полноэкранный viewer в стиле Telegram/Instagram: открывается с первого `!isViewed`, но сам modal показывается только после того, как первый fullscreen-кадр этой сторис уже прошёл `expo-image` preload/decode (`Image.prefetch(..., "memory-disk")` + `Image.loadAsync()` в `storyMediaPreload.ts`), поэтому на штатном открытии не должно быть ни чёрного экрана, ни fullscreen-спиннера. Сверху сегментированный прогресс по всему набору, фото авто-листаются через 7 с, прямые видео (`kind='video'`) проигрываются через `expo-video` `VideoView` + `VideoPlayer`: для cold-start видео под плеером лежит fullscreen `cover_url`, но для уже заранее прогретого next-video poster скрывается сразу, чтобы не было микроскачка между `cover_url` и первым живым кадром MP4; сам прогресс идёт по `timeUpdate` реального playback. Для ускорения переходов viewer держит двухслотовый video preload: текущий плеер и отдельный заранее загретый ближайший следующий direct-video с `useCaching`, уменьшенным startup buffer (`preferredForwardBufferDuration ~= 2s`, `waitsToMinimizeStalling = false`). Поддерживаются tap left/right и horizontal swipe. Локальная пометка `isViewed` не должна сбрасывать viewer обратно на первый слайд. Легаси `kind='video_cover'` показывается статичной обложкой. На natural finish пишет `completed=true`, на раннем закрытии/пролистывании — `completed=false`. **Алгоритм перехода**: прогресс привязан к реально отображаемому `displayIndex` и не уходит на следующий сегмент раньше смены кадра; перед открытием и во время просмотра preload/decode получает окно full-кадров (первая непросмотренная + до 4 вперёд, затем neighborhood `2 назад + 3 вперёд`), а для видео ближайший следующий MP4 дополнительно буферизуется отдельным player ещё до показа.
- **`fetchStoryFeed(userId): Promise<StoryItem[]>`** — RPC `get_story_feed`, который возвращает весь активный набор сторис (24h + evergreen) в стабильном порядке для кольца и viewer. `StoryItem`: `id`, `kind`, `imageUrl/coverUrl/videoUrl/thumbnailUrl`, `captionText`, `publishAt`, `expiresAt`, `isViewed`.
- **`markStoryViewed(userId, storyId, completed)`** — upsert в `user_story_views` под RLS «только своё»; `completed=true` при досмотре.

**Клиент (`modules/posts`, barrel `index.ts`):**

- **`PostsFeedScreen`** — вкладка «Публикации» (`app/(tabs)/posts.tsx`, между «Практики» и «Профиль», без тарифного гейта). Карточки: обложка 16:9, заголовок, дата (Luxon, активная локаль) + счётчик комментариев (`tCount`). Pull-to-refresh, перезагрузка на фокусе.
- **`PostScreen`** — экран публикации (`app/post/[id].tsx`, stack): обложка, заголовок, дата, тело через **`LinkifiedBody`** (plain text; URL кликабельны — `splitBodyIntoSegments` в `core/linkify.ts` не захватывает хвостовую пунктуацию), ниже — `CommentsSection`.
- **`CommentsSection`** — переиспользуемый блок комментариев к цели `('post'|'webinar')`: список (имя, относительное время, лайк ♥ с оптимистичным апдейтом, удаление своих с confirm), поле ввода (≤2000 симв.). На вебинарах лайк = голос за вопрос.
- **`LatestPostBanner`** — анонс новейшей публикации на главной (заменил захардкоженную заглушку `AnnouncementBanner`); `null`, пока публикаций нет. Этап 3 добавит приоритет вебинарного анонса.
- **`postsClient.ts`**: `fetchPostsFeed` (RPC `get_posts_feed`), `fetchComments` (RPC `get_target_comments`), `addComment`/`deleteOwnComment`/`setCommentLike` — прямые запросы под RLS.

**Админка (гейт `requireAdmin`, см. `admin_panel`):**

- `GET /api/admin/stories` — список всех (включая черновики/истёкшие, ≤200). Создание теперь split на `POST /api/admin/uploads` → `POST /api/admin/stories/process`: raw-файл грузится во временный `story-media/tmp/stories/*`, затем server-side pipeline (`sharp` / `ffmpeg`) генерирует финальный `image_url` или `video_url`, `cover_url` для видео и `thumbnail_url` для кольца, после чего пишет строку в `stories`. Для видео pipeline теперь жёстко нормализует клип под stories playback: `1080x1920` crop, `H.264 High`, `AAC 128 kbps`, `30 fps`, `-movflags +faststart`, poster `cover_url` тоже в `1080x1920` и берётся с самого начала ролика, чтобы не расходиться с первым живым кадром MP4; runtime не доверяет сырому `ffprobe.path`, а пересобирает абсолютный путь к бинарнику от `ffprobe-static/package.json`, чтобы dev/Vercel bundling не ломали spawn. Payload нормализуется `storyPayload.ts`: **`expires_at = publish_at + 24h` по умолчанию**, `caption` → `{text, translations?}`, `kind: 'image'|'video'`.
- `PATCH/DELETE /api/admin/stories/[id]` — частичное обновление (публикация/снятие, подпись + `caption_translations`, сроки, `order_hint`) / удаление строки **вместе с файлами** в `story-media`, включая `thumbnail_url`. При обновлении `caption_translations` выполняется read-merge с текущим caption.
- `POST /api/admin/stories/process` — принимает опциональный `update_id`: если передан, процессинг обновляет медиафайлы существующей сторис (удаляет старые assets) вместо создания новой. Также принимает `caption_translations` для записи переводов при создании.
- `POST /api/admin/uploads` — signed upload URL в бакет `story-media` (`createSignedUploadUrl`, service role); для сторис теперь принимает также `folder` и `bytes`, чтобы складывать raw uploads в `tmp/stories/*` и резать oversized файлы до обработки. Браузер грузит напрямую в Storage (`uploadToSignedUrl`, anon-клиент), минуя лимит тела Vercel. Ответ: `{path, token, publicUrl}`.
- `POST /api/admin/stories/cleanup` — батчевый idempotent cleanup истёкших published stories: удаляет DB rows и связанные `image_url` / `video_url` / `cover_url` / `thumbnail_url` из `story-media`.
- `POST /api/admin/translate` — новый роут; принимает `{type: 'story'|'post', ru_caption?, ru_title?, ru_body?}`; возвращает JSON-переводы на 7 целевых локалей (en/de/fr/it/es/pt/nl) одним запросом к `AI_MODEL_PREMIUM` через `generateGeminiJson`.
- UI `/admin/stories`: форма создания (файл → локальное превью, подпись, «Опубликовать сразу»/датой, «Бессрочная», «Автоперевод» + кнопка «Перевести» с аккордеоном переводов) + список карточек со статусом (Черновик / Запланирована / Активна / Истекла), кнопка-карандаш → `EditStoryModal` (редактирование подписи, замена медиа, переводы, чекбоксы «Опубликована»/«Бессрочная», кнопка «Сохранить»), toggle публикации, удаление с confirm. Активные переводы помечаются иконкой 🌐.
- `GET/POST /api/admin/posts` — список всех публикаций (≤200, включая черновики, со счётчиком комментариев) / создание (`postPayload.ts`: заголовок обязателен; `published_at = now()` при `is_published` без явной даты).
- `GET/PATCH/DELETE /api/admin/posts/[id]` — публикация + все комментарии (включая скрытые, embed `users!comments_user_id_fkey(display_name)`) / частичное обновление (`published_at` проставляется при первом включении публикации; при i18n-полях проставляется `translations_updated_at`) / удаление вместе с комментариями (полиморфная связь — без FK) и обложкой в `post-covers`.
- `PATCH/DELETE /api/admin/comments/[id]` — модерация: скрыть/показать (`{is_hidden}`) / удалить безвозвратно.
- `POST /api/admin/uploads` принимает `{bucket: 'story-media'|'post-covers', contentType}` (у `post-covers` только изображения, 20 МБ).
- UI `/admin/posts`: список карточек с иконкой 🌐 если есть переводы → `/admin/posts/[id]` (редактор `PostEditor`: языковые вкладки RU/EN/DE/FR/IT/ES/PT/NL, кнопка «Перевести», обложка+заголовок+текст для каждого языка, чекбокс «Опубликована»/«Опубликовать сразу», кнопка «Сохранить»/«Опубликовать») + `/admin/posts/new`; под редактором — модерация комментариев (скрыть/показать/удалить).

## 3. Данные

- **`stories`**: `kind` расширен миграцией `20260708120000` до `('image','video','video_cover')`; follow-up `20260708200500` добавляет `thumbnail_url`. `video` = прямой файл из Storage в `video_url` (+ `cover_url`-poster и `thumbnail_url`), `image` = server-optimized JPEG 1080x1920 + tiny square thumbnail, `video_cover` — легаси-обложка с внешним хостингом. `caption` jsonb `{text, translations?}` — авторский контент; `translations` = объект `{en, de, fr, it, es, pt, nl}`, генерируется через LLM (не UI-строка).
- **`user_story_views`** — PK `(user_id, story_id)`, `completed`; RLS self-all.
- **Storage `story-media`** (public read, 200 МБ/файл, mime: jpeg/png/webp/gif/mp4/mov/webm): в админском pipeline raw uploads сначала попадают в `tmp/stories/YYYY-MM-DD/*`, финальные optimized assets — в `processed/stories/YYYY-MM-DD/*`; policies: public select, admin write (запись фактически через service role).
- RPC **`get_story_feed`** (security definer) — активные опубликованные сторис в стабильном порядке + `is_viewed`; клиент сам вычисляет `firstUnviewedIndex`. Старый `get_user_stories` оставлен как legacy-compatible RPC, но мобильный клиент на него больше не опирается.
- **`posts`** (`20260708130000` + `20260709100000`): `title`, `body` (plain text: переносы + URL), `cover_url`, `is_published`, `published_at`, `created_by`; плюс i18n-поля: `title_i18n` / `body_i18n` / `cover_url_i18n` (jsonb, DEFAULT `{}`), `translations_updated_at` (timestamptz). RLS: public read опубликованных (`published_at <= now()`), admin write. Индекс `published_at desc where is_published`.
- **`comments`** — единая полиморфная таблица (`target_type in ('post','webinar')`, `target_id` без FK; целостность — на серверных роутах админки): `body` ≤2000, `is_hidden`. RLS: authenticated read (скрытые видит только автор), insert/delete своих, admin all.
- **`comment_likes`** — PK `(comment_id, user_id)`; RLS: read authenticated, insert/delete своих.
- **Storage `post-covers`** (public read, 20 МБ, только изображения) — по образцу `story-media`.
- RPC **`get_posts_feed(p_limit)`** (security definer) — опубликованные посты + `comment_count` (видимых). RPC **`get_target_comments(p_target_type, p_target_id, p_user_id)`** (security definer) — комментарии с `display_name` (nullable — имена чужих users не читаются под RLS), `like_count`, `liked_by_me`, `is_mine`.

## 4. i18n

UI-строки — ключи `stories.*` и `posts.*` (+`tabs.posts`) в `modules/i18n/catalog/ru.json` (через `useTranslate`/`tc`), синхронизированы на все 8 локалей. Плюрал счётчика — `posts.comments.count.*` через `tCount`. Фолбэк имени комментатора — ключ `posts.comments.anonymous` на клиенте (RPC возвращает `display_name: null`, русский фолбэк в SQL убран миграцией `20260708131000`). Контент (`caption.text`, тела публикаций, комментарии) остаётся на языке автора. Переводы контента (`caption.translations`, `title_i18n`/`body_i18n`) генерируются LLM на стороне сервера (`POST /api/admin/translate`) и хранятся в jsonb-полях — не через UI-catalog. Мобильный клиент пока отображает только русский контент; i18n-поля зарезервированы для будущего переключения по локали пользователя.

## 5. Известные ограничения

- Клиент по-прежнему получает только один progressive MP4-variant на сторис; HLS/ABR ladder, quality switching и отдельный low-bitrate preview-video пока не реализованы.
- Server-side video pipeline ограничен короткими сторис: raw video до 120 МБ и до 90 секунд. На выходе клиент получает только один MP4-variant (`1080x1920`, `H.264`, `AAC`, `30 fps`, maxrate `~7 Mbps`) + один poster `cover_url`; adaptive preview/full ladders и auto-splitting длинных роликов на несколько stories пока не реализованы.
- `announcements` (+RPC) остаются нетронутыми — кандидат на депрекацию (см. `open_questions.md`).
- Отдельного `FeatureKey` нет: сторис видны на всех тарифах.
