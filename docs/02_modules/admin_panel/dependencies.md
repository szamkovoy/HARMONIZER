---
id: 02_modules/admin_panel/dependencies
title: Admin Panel Dependencies
version: 1.3
updated: 2026-07-22
depends_on: [02_modules/subscription/spec, 02_modules/infra/spec]
code_refs:
  [
    _legacy_web/app/api/_utils/supabase.ts,
    _legacy_web/app/api/admin/_utils/authEmails.ts,
    modules/access/core/paidAccess.ts,
    modules/support/core/supportClient.ts,
    modules/metrics/core/appOpen.ts,
    modules/location/acquireAndPersistUserCoordinates.ts,
    supabase/migrations/20260708010000_admin_panel_tier_foundation.sql,
    supabase/migrations/20260708170000_payments_users_admin.sql,
    supabase/migrations/20260721120000_admin_dashboard_pulse.sql,
  ]
---

## 1. Зависит от

- **`infra`** — Supabase (`user_roles`, `is_admin`, service role), Vercel-деплой `_legacy_web`, Tailwind v4, PWA-манифест. Хелперы `createServiceSupabase` / `requireUserId` / `requireAdmin` в `app/api/_utils/supabase.ts`. Пульс читает `user_event_log` (`dialog_turn`, `llm_*`, `api_error`, `app_open`, `llm_prompt_size`) и колонки `users.last_seen_at` / `country_code` / `city`.
- **`subscription`** — модель тарифов: канон имён/порядка/фич в `modules/access/core/{tiers,features}.ts` (`TIER_LABELS_RU`, `PAID_PRODUCT_TIERS`, `TIER_ORDER`); runtime-доступ по полям `users` — `paidAccess.ts`. Сегмент **trial** на дашборде — `trial_expires_at > now()` (даже при `membership_tier=free`). Ручной грант пишет `payments`; **net**-выручка — `payment_settlements` (пишет account_web на вебхуке Lava). Hourly reconcile — Edge/SQL в infra.
- **`account_web`** — `payment_settlements` + FX; админка только читает nets. Контракты Lava.top/ЮКасса → списки и воронки; `payment_catalog` редактируется из админки (цены/тексты для ЮKassa checkout).
- **`author_presence`** (сторис/публикации/комментарии), **`webinars`**, **`notifications`**, **`marketing_email`** — admin_panel их управляющая консоль; продуктовые контракты в спеках этих модулей.
- **`assistant`** — таблица `prompts`; playground Gemini; dialog-путь пишет `dialog_turn` / `llm_prompt_size` через `logDialogTurn` / `logLlmPromptSize` (`monitoring.ts`) — сырьё LLM-блока пульса.
- **`profile`** — карточка «Поддержка» → `SupportModal`; geo/last_seen пишутся в `users` с клиента (`acquireAndPersistUserCoordinates`, `logAppOpen`).

## 2. От него зависят

- Мобильный клиент не знает о `/admin` — общая точка только БД. Клиентские куски для админ-метрик: `modules/support`, `modules/metrics` (`app_open` + `last_seen_at`), `modules/location` (`country_code`/`city`).
- `assistant` зависит от активной версии в `prompts`: активация версии из админки немедленно меняет боевые промпты.

## 3. Контрактные точки риска

- **`requireAdmin` обязателен в каждом новом роуте `app/api/admin/*`** — роут без него станет дырой: service role обходит RLS.
- **Смена схемы `user_roles` / `is_admin`** ломает и RLS-политики БД, и серверный гейт.
- **`membership_expires_at`**: сервер и клиент должны использовать общий `paidAccess.ts`; локальная проверка «tier === 'premium'» где-либо ещё вернёт старую бинарную модель.
- **RPC `admin_search_users` / `admin_dashboard_metrics` / `admin_dashboard_pulse` / `admin_llm_metrics` / `admin_user_access_segment`** — security definer с revoke у anon/authenticated; при пересоздании функций revoke нужно повторять.
- **Инвариант промптов:** на ключ всегда ровно одна активная версия; API запрещает прямую деактивацию активной (иначе боевой код уходит в fallback «последняя версия» с warning).
- **Payload-контракт метрик:** `latency_ms` в `dialog_turn`; в `llm_prompt_size` предпочтительно `total_tokens` (иначе сумма ключей `*_tokens` кроме `total_tokens`). Переименование полей молча обнулит LLM-метрики пульса.
