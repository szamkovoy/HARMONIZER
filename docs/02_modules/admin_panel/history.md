---
id: 02_modules/admin_panel/history
title: Admin Panel History
version: 1.0
updated: 2026-07-08
depends_on: [02_modules/subscription/spec]
code_refs: [supabase/migrations/20260708010000_admin_panel_tier_foundation.sql]
---

## Decision Log

- **2026-07-08 (3):** Этапы 5–8 завершены — админка полностью реализована.
  - **Этап 5 (поддержка):** таблица `support_messages` + RLS self-insert/select; клиентская форма `modules/support` (`SupportModal` в Профиле, insert под RLS без сервера); `/admin/feedback` с отметкой «обработано». Решение: канал односторонний, ответ уходит на почту аккаунта — треды в приложении не строим.
  - **Этап 6 (пользователи):** леджер `payments` (source `manual`/`store`/`promo`; сторы отложены) + RPC `admin_search_users` (security definer c join на auth.users — email не дублируем в public.users); `/admin/users` (поиск, фильтр), карточка с ручным назначением тарифа (пишет и users, и леджер; free сбрасывает срок без записи в леджер).
  - **Этап 7 (дашборд):** RPC `admin_dashboard_metrics`+`admin_llm_metrics` — агрегаты целиком в БД; клиентское событие `app_open` (модуль `modules/metrics`, троттлинг 30 мин, хук в `PushRegistrationBridge`); `DashboardMetrics` на `/admin`. Решение: активность считаем по всем событиям `user_event_log`, а не только `app_open`, чтобы метрика работала и до раскатки нового клиента.
  - **Этап 8 (промпты):** `/admin/prompts` — версии с наследованием метаданных (новая = max+1), инвариант «одна активная на ключ» (деактивация только через активацию другой), generic playground через боевой Gemini-пайплайн. Prompt Studio (`/api/ai/prompt-studio` + `middleware.ts`) удалён; `PROMPT_STUDIO_TOKEN` в Vercel не нужен.
  - Все этапы прошли E2E-смоуки на dev-сервере (скрипты создавали и подчищали тестовые данные). Попутно стабилизирован `vimeo.test.ts`: тест чистил только `VIMEO_ACCESS_TOKEN`, а `vimeoToken()` читает ещё `vimeo_token`/`VIMEO_TOKEN` из корневого `.env.local` — тест ходил в сеть.

- **2026-07-08 (2):** Этап 1 «Stories» завершён: раздел `/admin/stories` (форма загрузки с превью, статусы, toggle публикации, удаление с очисткой Storage), роуты `/api/admin/stories*` + `/api/admin/uploads` (signed upload URL — файл идёт в Storage напрямую из браузера), миграция `20260708120000_stories_storage.sql` (бакет `story-media`, `kind='video'`), клиентское кольцо+вьюер в `modules/stories`. Владелец продуктового контракта — модуль `author_presence`. E2E проверено на dev-сервере (создание→RPC→снятие→удаление с зачисткой бакета). Также решено: пароль владельцу задан через Auth Admin API (recovery-ссылки Supabase сгорали из-за предзагрузки Gmail и вели на страницу без обработчика).

- **2026-07-08:** Этап 0 «Фундамент». Утверждён план архитектуры (этапы 0–8: фундамент → сторис → публикации+комментарии → вебинары → уведомления → обратная связь → пользователи/гранты → дашборд → промпты). Решения: админка встраивается в `_legacy_web` (не отдельный репозиторий/проект), auth через существующий Supabase-аккаунт + роль `user_roles.admin` + новый серверный `requireAdmin()`; публикации — новая таблица `posts` (существующая `announcements` — баннерная модель, остаётся в резерве); комментарии — одна полиморфная таблица для публикаций и вопросов к вебинарам; медиа — Supabase Storage; оплаты — только леджер `payments`, реальная интеграция отложена (решение владельца); уведомления получат гарантированный канал `notification_deliveries` + «Мои уведомления» в Профиле (пуш-разрешения не обязательны). Реализовано: shell `/admin` + login + PWA-манифест + заглушки разделов, `GET /api/admin/me`, миграция `20260708010000` (4 тира, `premium`→`oracle`, `membership_expires_at`), единый хелпер платного доступа `modules/access/core/paidAccess.ts` (вместо 5 дублей условия premium/trial), vendored-копия для Vercel через `scripts/sync-vercel-server-modules.mjs`. Попутно починена история миграций Supabase (3 локальных файла были применены в обход `db push`; удалённый дубль `20260706222434` помечен reverted).
