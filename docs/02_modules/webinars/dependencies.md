---
id: 02_modules/webinars/dependencies
title: Webinars Dependencies
version: 2.0
updated: 2026-07-08
depends_on: [02_modules/subscription/spec, 02_modules/author_presence/spec, 02_modules/admin_panel/spec]
code_refs:
  [
    modules/webinars/core/webinarsClient.ts,
    modules/webinars/ui/WebinarScreen.tsx,
    modules/access/core/features.ts,
    supabase/migrations/20260708140000_webinars.sql,
  ]
---

## 1. Зависит от

- **`subscription`** — `useAccess().canUseFeature("webinar_community")` + `UpgradeDialog`/`requiredTierFor` для гейта записи (Master).
- **`author_presence` (posts)** — переиспользует `CommentsSection` (вопросы = комментарии `target_type='webinar'`, лайк = голос) и `LinkifiedBody`; таблицы `comments`/`comment_likes` и их RLS.
- **`admin_panel`** — авторский ввод: `/admin/webinars` + `/api/admin/webinars*` под `requireAdmin`; модерация вопросов через общий `/api/admin/comments/[id]`; email записавшихся — `_utils/authEmails.ts` (auth.users через Admin API).
- **`infra`** — Supabase: таблицы `webinars`/`webinar_registrations`, RLS; singleton `services/supabase.ts`.
- **`i18n`** — ключи `webinars.*`, Luxon с активной локалью.
- **auth** — `useAuth().authUser.id` для регистраций и вопросов.

## 2. От него зависят

- **`daily_forecast` (главный экран)** — `UpcomingWebinarBanner` на `app/(tabs)/index.tsx` (над `LatestPostBanner`).
- **`author_presence` (posts)** — `WebinarsStrip` в шапке `PostsFeedScreen` (взаимная зависимость модулей posts ↔ webinars, осознанная: вкладка «Публикации» — хаб авторского контента).

## 3. Контрактные точки риска

- **`recording_url` в public-read строке** — тарифный гейт только клиентский; перенос под серверный гейт потребует отдельного API/подписанных URL.
- **Вопросы живут в `comments` без FK** — `DELETE /api/admin/webinars/[id]` обязан удалять их сам (регистрации каскадятся FK).
- **`webinar_registrations` — сегмент этапа 4** (рассылка «вебинар скоро» и «запись доступна»): менять схему только вместе с notifications.
- **Смена ключа `webinar_community`** ломает гейт записи в `WebinarScreen`.
