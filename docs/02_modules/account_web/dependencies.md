---
id: 02_modules/account_web/dependencies
title: Account Web Dependencies
version: 1.0
updated: 2026-07-14
depends_on: [02_modules/account_web/spec]
code_refs:
  [
    modules/account/core/openAccountCabinet.ts,
    modules/account/core/accountLinksConfig.ts,
    modules/account/ui/MembershipEventsBridge.tsx,
    modules/access/ui/AccountGateDialog.tsx,
    _legacy_web/app/api/account/session/route.ts,
    web_cabinet/cabinet.html,
  ]
---

## 1. Зависит от

- **`profile` (auth)** — `useAuth()` даёт `authUser`, `profile`, `refreshProfile`; OTT-запрос подписывается `getSupabaseAccessToken()`. `MembershipEventsBridge` монтируется в `app/_layout.tsx` строго под `AuthProvider`.
- **`subscription`** — `baseTierFromRow` / `hasActiveTrial` / `TIER_ORDER` для детекта смены уровня; `VISIBLE_PAID_PRODUCT_TIERS` для `upgradeTiers` в overview. Сервер использует vendored-копию `_legacy_web/modules/access` (`scripts/sync-vercel-server-modules.mjs`).
- **`i18n`** — тексты `gate.*` и `tier.*` из JSON-каталога; язык страницы кабинета передаётся параметром `lang` (из `getResponseLocale()`), словари страницы зашиты в `cabinet.html` (8 локалей) и НЕ входят в i18n-sync gate.
- **`infra`** — Vercel-роуты `/api/account/*` (общие утилиты `_legacy_web/app/api/_utils/supabase.ts`); Supabase-таблицы `web_ott_tokens`, `app_config`, `payment_contracts`; publication `supabase_realtime` для `users`.
- **`location`** — `resolveBillingCurrency` читает кэш координат (`userLocationProfileCache`) и `expo-location.reverseGeocodeAsync` для определения страны → валюты цен кабинета.
- **Lava.top (внешний)** — `gate.lava.top`: `POST /api/v2/invoice` (создание подписки), `DELETE /api/v1/subscriptions` (отмена), вебхуки на `/api/account/webhooks/lava` (auth `X-Api-Key`). offerId тарифов — env `LAVATOP_TARIFF_2_ID`/`LAVATOP_TARIFF_3_ID`.

## 2. От него зависят

- **`subscription`** — `AccountGateDialog` / `AccountUpsellPanel` вызывают `openAccountCabinet()` и `useAccountLinksEnabled()`; все точки гейтинга приложения ведут в кабинет через этот модуль.
- **Веб-страница на WordPress** — контракт `POST /api/account/session` и `GET /api/account/overview` (форма `AccountOverview`); при изменении полей overview синхронно править `cabinet.html`.

## 3. Контрактные точки риска

- **CORS** — `/api/account/session|overview` отвечают только для `ACCOUNT_CABINET_ALLOWED_ORIGIN`. Смена домена сайта = правка env + `API_BASE` в `cabinet.html`.
- **Форма `AccountOverview`** — единственный контракт «Vercel ↔ WordPress»; поле `tier` наружу никогда не равно `practitioner` (маппится в `oracle`).
- **`app_config.account_links_enabled`** — читается клиентом напрямую из Supabase (RLS select authenticated) с fail-safe `false`; удаление строки = скрытие всех кнопок ЛК.
- **Realtime на `users`** — требует, чтобы строка оставалась в publication `supabase_realtime` и RLS-select своей строки не сузился; иначе подхват уровня деградирует до foreground-refetch.
- **Секрет `ACCOUNT_CABINET_SECRET`** — ротация мгновенно инвалидирует активные кабинетные сессии (это ок: страница перезапросит OTT-переход из приложения).
- **Цены в `cabinet.html` (`PRICES`)** — дубликат цен офферов Lava; при изменении цен в кабинете Lava обязательна синхронная правка страницы (списывается всегда цена оффера Lava, страница — только витрина).
- **Вебхуки Lava** — 2xx останавливает ретраи: «неизвестный контракт» отвечаем 200 (иначе 20 бессмысленных повторов), транзиентные ошибки БД — 5xx. Смена `LAVATOP_WEBHOOK_SECRET` требует одновременной правки в ЛК Lava и Vercel env.
