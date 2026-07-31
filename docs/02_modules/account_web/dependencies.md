---
id: 02_modules/account_web/dependencies
title: Account Web Dependencies
version: 1.5
updated: 2026-07-31
depends_on: [02_modules/account_web/spec]
code_refs:
  [
    modules/account/core/openAccountCabinet.ts,
    modules/account/core/accountLinksConfig.ts,
    modules/account/ui/MembershipEventsBridge.tsx,
    modules/access/ui/AccountGateDialog.tsx,
    _legacy_web/app/api/account/session/route.ts,
    web_cabinet/cabinet/index.html,
  ]
---

## 1. Зависит от

- **`profile` (auth)** — `useAuth()` даёт `authUser`, `profile`, `refreshProfile`, `signOut`; OTT-запрос и `deleteAccountRemote` подписываются `getSupabaseAccessToken()`. `MembershipEventsBridge` монтируется в `app/_layout.tsx` строго под `AuthProvider`. Профиль вызывает `DELETE /api/account/delete` при «Удалить аккаунт».
- **`subscription`** — `baseTierFromRow` / `hasActiveTrial` / `TIER_ORDER` для детекта смены уровня; `VISIBLE_PAID_PRODUCT_TIERS` для `upgradeTiers` в overview. Сервер использует vendored-копию `_legacy_web/modules/access` (`scripts/sync-vercel-server-modules.mjs`).
- **`i18n`** — тексты `gate.*` и `tier.*` из JSON-каталога; язык страницы кабинета передаётся параметром `lang` (из `getResponseLocale()`), словари страницы зашиты в `web_cabinet/cabinet/index.html` (8 локалей) и НЕ входят в i18n-sync gate.
- **`infra`** — Vercel-роуты `/api/account/*` (общие утилиты `_legacy_web/app/api/_utils/supabase.ts`); Supabase-таблицы `web_ott_tokens`, `app_config`, `payment_contracts`; publication `supabase_realtime` для `users`.
- **`marketing_email`** — `wipeUserAccount` отменяет активные `email_automation_enrollments` через `cancelActiveEmailAutomationsForUser` (`emailAutomationRunner`), чтобы рассылки не шли после удаления аккаунта.
- **`location`** — `resolveBillingCurrency` читает кэш координат (`userLocationProfileCache`) и `expo-location.reverseGeocodeAsync` для страны → валюты; таймаут 800 мс + персистентный флаг `billingCurrency`, чтобы гео не блокировало `openURL`.
- **`webinars`** — разовая оплата вебинара (ONE_TIME) через Lava или ЮKassa: вебхук успеха upsert `webinar_registrations`; `MembershipEventsBridge` детектит one_time `kind=webinar` через `GET /api/account/purchases/last` после визита в кабинет с **любым** ctx и показывает модалку `gate.webinarPaid.*`; `WebinarScreen` повторно проверяет `isRegistered` в foreground; кнопки «Отменить запись» нет.
- **Lava.top (внешний)** — `gate.lava.top`: `POST /api/v2/invoice`, `GET /api/v2/products` (цены, кэш 10 мин), `DELETE /api/v1/subscriptions`, вебхуки `/api/account/webhooks/lava`. Маппинг — `payment_offers`. Используется при `PAYMENT_LAVATOP_ENABLED` + `REGION=INT` (или country-match). См. `lava_integration.md`, `docs/04_workspace/payment_gateways.md`.
- **ЮKassa (внешний)** — `api.yookassa.ru/v3`: create payment (redirect), charge saved method, GET payment из вебхука; уведомления на `/api/account/webhooks/yookassa`. Цены RUB — `payment_catalog`. Выбор — `resolvePaymentGateway({ country })` (`paymentGatewayProfile.ts`). Recurring: cron `/api/cron/yookassa-renewals`. Cancel/wipe → methods `inactive`. Fee settlement 2.5% (`yookassa` / `YANDEX_GATEWAY_FEE_RATE`).
- **FX-источники (внешние, settlement)** — Т-Банк `GET https://api.tinkoff.ru/v1/currency_rates` (категория `DebitCardsOperations`); ЦБ через `https://www.cbr-xml-daily.ru/daily_json.js`. Цепочка T-Bank → CBR; суточный кэш `fx_daily_quotes` (дата по Москве); при сбое Т-Банка в этот день — только ЦБ до завтра. Результаты — `payment_settlements` + net-колонки на `payment_contracts`.

## 2. От него зависят

- **`subscription`** — `AccountGateDialog` / `AccountUpsellPanel` вызывают `openAccountCabinet()` и `useAccountLinksEnabled()`; все точки гейтинга приложения ведут в кабинет через этот модуль.
- **`profile`** — ссылки «Выйти» / «Удалить аккаунт» на `app/(tabs)/profile.tsx` (`deleteAccountRemote`).
- **`admin_panel`** — KPI/графики **net**-выручки и `/admin/payments/stats` читают `payment_settlements` (`lavatop` / `yookassa`); ручной леджер `payments` — отдельно как гранты.
- **Веб-страница кабинета (standalone на zamkovoi.yoga)** — контракт `POST /api/account/session` и `GET /api/account/overview` (форма `AccountOverview`); при изменении полей overview синхронно править `web_cabinet/cabinet/index.html`. Оферта — статика Vercel `/cabinet/offer/{lang}.json` (только по клику). Страница не должна отдаваться через тему WordPress.

## 3. Контрактные точки риска

- **CORS** — `/api/account/session|overview` отвечают только для `ACCOUNT_CABINET_ALLOWED_ORIGIN`. Смена домена сайта = правка env + `API_BASE` в `web_cabinet/cabinet/index.html`.
- **Форма `AccountOverview`** — единственный контракт «Vercel API ↔ страница кабинета»; поле `tier` наружу никогда не равно `practitioner` (маппится в `oracle`).
- **`app_config.account_links_enabled`** — читается клиентом напрямую из Supabase (RLS anon+authenticated на этот ключ) с fail-safe `false`; персист последнего явного значения; удаление строки = скрытие всех кнопок ЛК. Краткий PostgREST 503 (schema cache) не должен оставлять кнопку скрытой навсегда — ретраи + персист.
- **Realtime на `users`** — требует, чтобы строка оставалась в publication `supabase_realtime` и RLS-select своей строки не сузился; иначе подхват уровня деградирует до foreground-refetch.
- **Секрет `ACCOUNT_CABINET_SECRET`** — ротация мгновенно инвалидирует активные кабинетные сессии (это ок: страница перезапросит OTT-переход из приложения).
- **Цены в кабинете** — из overview: Lava products или `payment_catalog` (ЮKassa/RUB). Смена Lava-цены — кэш 10 мин; смена ЮKassa — SQL/`payment_catalog`.
- **Хостинг кабинета** — standalone HTML на том же origin (`https://zamkovoi.yoga`), иначе CORS сломает `session`/`overview`. После оплаты ЮKassa return без OTT опирается на `sessionStorage` кабинетной сессии.
- **Маппинг `payment_offers`** — Lava: язык/тариф = строка + продукт в Lava. ЮKassa RUB — строки `payment_catalog`.
- **Вебхуки Lava** — 2xx останавливает ретраи: «неизвестный контракт» → 200; транзиентные ошибки БД — 5xx. Смена `LAVATOP_WEBHOOK_SECRET` — одновременно в ЛК Lava и Vercel.
- **Вебхуки ЮKassa** — всегда перечитываем payment через API; опц. `YOOKASSA_WEBHOOK_SECRET`. URL уведомлений в кабинете ЮKassa должен совпадать с production Vercel origin.
