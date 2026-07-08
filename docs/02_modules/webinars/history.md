---
id: 02_modules/webinars/history
title: Webinars History
version: 2.0
updated: 2026-07-08
depends_on: [02_modules/subscription/spec]
code_refs: [supabase/migrations/20260708140000_webinars.sql]
---

## Decision Log

- **2026-07-08:** Вебинары реализованы end-to-end (этап 3 админ-панели). Решения: новая таблица `webinars` вместо легаси `announcements.kind='webinar'` (баннерная модель не тянет регистрации/записи; announcements — кандидат на депрекацию); вопросы — переиспользование полиморфных `comments` (`target_type='webinar'`) и `comment_likes` как голосов, UI — общий `CommentsSection` из posts; записавшиеся (`webinar_registrations`, PK webinar+user, RLS self) — одновременно будущий сегмент рассылки этапа 4; email для админ-списка записавшихся тянется из auth.users точечными `getUserById` (в `public.users` email нет); запись вебинара гейтится по тарифу Master **клиентски** (`webinar_community` + UpgradeDialog) — `recording_url` остаётся в public-read строке, осознанный компромисс; на главной — отдельный `UpcomingWebinarBanner` над `LatestPostBanner` (а не вытеснение), в «Публикациях» — `WebinarsStrip` с предстоящими и записями. E2E-смоук: create→RLS read→register→question→vote→admin detail (голоса, email)→attach recording→delete (вопросы+регистрации зачищены).

- **2026-05:** Модуль зафиксирован в документации как **запланированный**; миграция выполнена для целостности графа Волны 3. В коде только задел доступа и схема БД под баннеры типа вебинара — отдельного runtime-модуля нет.
