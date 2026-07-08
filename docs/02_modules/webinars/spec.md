---
id: 02_modules/webinars/spec
title: Webinars Spec
version: 2.0
updated: 2026-07-08
depends_on: [02_modules/subscription/spec, 02_modules/author_presence/spec, 02_modules/admin_panel/spec, 02_modules/i18n/spec]
code_refs:
  [
    modules/webinars/index.ts,
    modules/webinars/core/webinarsClient.ts,
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
    _legacy_web/app/api/admin/webinars/webinarPayload.ts,
    _legacy_web/app/api/admin/_utils/authEmails.ts,
    modules/access/core/features.ts,
    supabase/migrations/20260708140000_webinars.sql,
  ]
---

## 1. Назначение (продукт)

Вебинары автора: анонс с датой, запись «Пойду», вопросы до эфира с голосованием, после эфира — ссылка на запись (просмотр записи — тариф **Master**, `webinar_community`). Реализовано в этапе 3 плана админ-панели.

## 2. Публичный контракт

**Клиент (`modules/webinars`, barrel `index.ts`):**

- **`WebinarScreen`** (`app/webinar/[id].tsx`) — анонс: заголовок, дата-время (Luxon, `DATETIME_MED_WITH_WEEKDAY`, активная локаль, зона устройства), описание через `LinkifiedBody` (из posts). До эфира: кнопка «Пойду»/«Отменить запись» (toggle `webinar_registrations` под RLS) и «Подключиться» (`join_url`, видна записавшимся). После эфира: блок «Запись» — для Master кнопка просмотра `recording_url`, для остальных locked-подсказка + `UpgradeDialog`. Вопросы — общий **`CommentsSection`** (`modules/posts`) с `targetType="webinar"`; лайк = голос за вопрос (сортировка по голосам — только в админке).
- **`UpcomingWebinarBanner`** — анонс ближайшего предстоящего вебинара на главной (`app/(tabs)/index.tsx`, над `LatestPostBanner`); `null`, если предстоящих нет.
- **`WebinarsStrip`** — компактный блок в шапке вкладки «Публикации» (`PostsFeedScreen`): все предстоящие + до 5 прошедших с записью; `null`, когда пусто.
- **`webinarsClient.ts`**: `fetchUpcomingWebinar`, `fetchWebinars` (`{upcoming, past}`; past — только с записью), `fetchWebinar`, `isRegistered`, `setRegistered` — прямые запросы под RLS.

**Админка (гейт `requireAdmin`):**

- `GET/POST /api/admin/webinars` — список (≤200, включая черновики, счётчики записавшихся/вопросов) / создание (`webinarPayload.ts`: title и starts_at обязательны).
- `GET/PATCH/DELETE /api/admin/webinars/[id]` — деталка: вебинар + вопросы (включая скрытые, `vote_count`, сортировка по голосам) + записавшиеся (имя, **email из auth.users** через `authEmails.ts`, тариф) / обновление (в т.ч. прикрепление `recording_url`) / удаление вместе с вопросами (регистрации — FK cascade).
- Модерация вопросов — общие `PATCH/DELETE /api/admin/comments/[id]`.
- UI `/admin/webinars` (+`/new`, `/[id]`): список карточек (статус, дата, «Запись прикреплена», счётчики) и редактор `WebinarEditor` (datetime-local в поясе админа, ссылки на трансляцию/запись, публикация; ниже — вопросы с голосами и список записавшихся).

## 3. Данные

- **`webinars`** (`20260708140000`): `title`, `description` (plain text + URL), `starts_at`, `join_url`, `recording_url`, `is_published`. RLS: public read опубликованных, admin write. Индекс `starts_at desc where is_published`.
- **`webinar_registrations`** — PK `(webinar_id, user_id)`, FK cascade; RLS: select/insert/delete своих, admin all. Этап 4 использует их как сегмент рассылки.
- **Вопросы** — общая таблица `comments` (`target_type='webinar'`), голоса — `comment_likes` (см. `author_presence`).
- `recording_url` лежит в public-read строке: гейт Master — **клиентский** (`canUseFeature("webinar_community")`); прямой запрос к БД URL раскроет. Осознанный компромисс для single-author продукта.

## 4. i18n

Ключи `webinars.*` в `modules/i18n/catalog/ru.json`, синхронизированы на 8 локалей. Даты — Luxon с активной локалью. Контент (title/description) — на языке автора.

## 5. Легаси-задел

`announcements.kind='webinar'` и RPC `get_user_announcement` (init-миграция) **не используются** — баннер работает от таблицы `webinars`. Кандидат на депрекацию вместе с `announcements` (см. `open_questions.md`).
