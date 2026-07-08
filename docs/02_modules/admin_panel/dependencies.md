---
id: 02_modules/admin_panel/dependencies
title: Admin Panel Dependencies
version: 1.1
updated: 2026-07-08
depends_on: [02_modules/subscription/spec, 02_modules/infra/spec]
code_refs:
  [
    _legacy_web/app/api/_utils/supabase.ts,
    _legacy_web/app/api/admin/_utils/authEmails.ts,
    modules/access/core/paidAccess.ts,
    modules/support/core/supportClient.ts,
    modules/metrics/core/appOpen.ts,
    supabase/migrations/20260708010000_admin_panel_tier_foundation.sql,
    supabase/migrations/20260708170000_payments_users_admin.sql,
  ]
---

## 1. Зависит от

- **`infra`** — Supabase (`user_roles`, `is_admin`, service role), Vercel-деплой `_legacy_web`, Tailwind v4, PWA-манифест. Хелперы `createServiceSupabase` / `requireUserId` / новый `requireAdmin` в `app/api/_utils/supabase.ts`. Метрики дашборда читают `user_event_log` (`dialog_turn`, `llm_*`, `api_error`, новое `app_open`).
- **`subscription`** — модель тарифов: миграция 4 тиров + `membership_expires_at` сделана в рамках admin_panel (этап 0); ручной грант тарифа (этап 6) пишет `users.membership_tier`/`membership_expires_at` + строку в `payments` по правилам `modules/access/core/paidAccess.ts`.
- **`author_presence`** (сторис/публикации/комментарии), **`webinars`**, **`notifications`** — admin_panel их управляющая консоль; продуктовые контракты в спеках этих модулей.
- **`assistant`** — таблица `prompts` (версии, `is_active`), `getActivePrompt`/`renderPrompt` (`app/api/_utils/prompts.ts`), Gemini-пайплайн (`app/api/_utils/gemini.ts`) для playground.
- **`profile`** — карточка «Поддержка» в Профиле открывает `SupportModal` (`modules/support`); insert в `support_messages` идёт под RLS без сервера.

## 2. От него зависят

- Мобильный клиент не знает о `/admin` — общая точка только БД. Клиентские куски, живущие в мобильном бандле, но обслуживающие админ-фичи: `modules/support` (форма поддержки) и `modules/metrics` (`app_open` для DAU/WAU/MAU).
- `assistant` зависит от активной версии в `prompts`: активация версии из админки немедленно меняет боевые промпты.

## 3. Контрактные точки риска

- **`requireAdmin` обязателен в каждом новом роуте `app/api/admin/*`** — роут без него станет дырой: service role обходит RLS.
- **Смена схемы `user_roles` / `is_admin`** ломает и RLS-политики БД, и серверный гейт.
- **`membership_expires_at`**: сервер и клиент должны использовать общий `paidAccess.ts`; локальная проверка «tier === 'premium'» где-либо ещё вернёт старую бинарную модель.
- **RPC `admin_search_users` / `admin_dashboard_metrics` / `admin_llm_metrics`** — security definer с revoke у anon/authenticated; при пересоздании функций revoke нужно повторять, иначе любой залогиненный получит email всех пользователей.
- **Инвариант промптов:** на ключ всегда ровно одна активная версия; API запрещает прямую деактивацию активной (иначе боевой код уходит в fallback «последняя версия» с warning).
- **Payload-контракт метрик:** `latency_ms` в `dialog_turn` и `*_tokens` в `llm_prompt_size` — если их переименовать в логировании, LLM-метрики дашборда молча обнулятся.
