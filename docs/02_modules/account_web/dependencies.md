---
id: 02_modules/account_web/dependencies
title: Account Web Dependencies
version: 1.2
updated: 2026-07-20
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

- **`profile` (auth)** — `useAuth()` даёт `authUser`, `profile`, `refreshProfile`, `signOut`; OTT-запрос и `deleteAccountRemote` подписываются `getSupabaseAccessToken()`. `MembershipEventsBridge` монтируется в `app/_layout.tsx` строго под `AuthProvider`. Профиль вызывает `DELETE /api/account/delete` при «Удалить аккаунт».
- **`subscription`** — `baseTierFromRow` / `hasActiveTrial` / `TIER_ORDER` для детекта смены уровня; `VISIBLE_PAID_PRODUCT_TIERS` для `upgradeTiers` в overview. Сервер использует vendored-копию `_legacy_web/modules/access` (`scripts/sync-vercel-server-modules.mjs`).
- **`i18n`** — тексты `gate.*` и `tier.*` из JSON-каталога; язык страницы кабинета передаётся параметром `lang` (из `getResponseLocale()`), словари страницы зашиты в `cabinet.html` (8 локалей) и НЕ входят в i18n-sync gate.
- **`infra`** — Vercel-роуты `/api/account/*` (общие утилиты `_legacy_web/app/api/_utils/supabase.ts`); Supabase-таблицы `web_ott_tokens`, `app_config`, `payment_contracts`; publication `supabase_realtime` для `users`.
- **`location`** — `resolveBillingCurrency` читает кэш координат (`userLocationProfileCache`) и `expo-location.reverseGeocodeAsync` для страны → валюты; таймаут 800 мс + персистентный флаг `billingCurrency`, чтобы гео не блокировало `openURL`.
- **`webinars`** — разовая оплата вебинара (ONE_TIME) через Lava: вебхук `payment.success` upsert `webinar_registrations`; `MembershipEventsBridge` детектит последнюю one_time-покупку `kind=webinar` через `GET /api/account/purchases/last` после визита в кабинет с **любым** ctx и показывает модалку `gate.webinarPaid.*`; `WebinarScreen` повторно проверяет `isRegistered` в foreground; кнопки «Отменить запись» нет (отмена без возврата денег лишена смысла).
- **Lava.top (внешний)** — `gate.lava.top`: `POST /api/v2/invoice` (подписка MONTHLY и разовая ONE_TIME), `GET /api/v2/products` (цены, кэш 10 мин), `DELETE /api/v1/subscriptions` (отмена), вебхуки на `/api/account/webhooks/lava` (auth `X-Api-Key`). Маппинг (tier, locale) → offerId в таблице `payment_offers` (fallback `en`; tier ∈ oracle/master/webinar/book/course); контракт/политики/мультиязычность — `lava_integration.md`.

## 2. От него зависят

- **`subscription`** — `AccountGateDialog` / `AccountUpsellPanel` вызывают `openAccountCabinet()` и `useAccountLinksEnabled()`; все точки гейтинга приложения ведут в кабинет через этот модуль.
- **`profile`** — ссылки «Выйти» / «Удалить аккаунт» на `app/(tabs)/profile.tsx` (`deleteAccountRemote`).
- **Веб-страница кабинета (standalone на zamkovoi.yoga)** — контракт `POST /api/account/session` и `GET /api/account/overview` (форма `AccountOverview`); при изменении полей overview синхронно править `web_cabinet/cabinet.html`. Оферта — статика Vercel `/cabinet/offer/{lang}.json` (только по клику). Страница не должна отдаваться через тему WordPress.

## 3. Контрактные точки риска

- **CORS** — `/api/account/session|overview` отвечают только для `ACCOUNT_CABINET_ALLOWED_ORIGIN`. Смена домена сайта = правка env + `API_BASE` в `cabinet.html`.
- **Форма `AccountOverview`** — единственный контракт «Vercel API ↔ страница кабинета»; поле `tier` наружу никогда не равно `practitioner` (маппится в `oracle`).
- **`app_config.account_links_enabled`** — читается клиентом напрямую из Supabase (RLS anon+authenticated на этот ключ) с fail-safe `false`; персист последнего явного значения; удаление строки = скрытие всех кнопок ЛК. Краткий PostgREST 503 (schema cache) не должен оставлять кнопку скрытой навсегда — ретраи + персист.
- **Realtime на `users`** — требует, чтобы строка оставалась в publication `supabase_realtime` и RLS-select своей строки не сузился; иначе подхват уровня деградирует до foreground-refetch.
- **Секрет `ACCOUNT_CABINET_SECRET`** — ротация мгновенно инвалидирует активные кабинетные сессии (это ок: страница перезапросит OTT-переход из приложения).
- **Цены в `cabinet.html`** — больше не захардкожены; единственный источник правды — Lava `GET /api/v2/products` (через `overview.upgradeTiers[].price`). Смена цены в Lava автоматически отражается в кабинете (кэш 10 мин).
- **Хостинг кабинета** — standalone HTML на том же origin (`https://zamkovoi.yoga`), иначе CORS (`ACCOUNT_CABINET_ALLOWED_ORIGIN`) сломает `session`/`overview`. Если URL снова попадёт под WP-тему — вернутся долгий белый экран и «залипший» progress Safari.
- **Маппинг `payment_offers`** — добавление языка/тарифа = строка в таблице + продукт в Lava, без правки кода. Fallback на `en` покрывает отсутствующие локали.
- **Вебхуки Lava** — 2xx останавливает ретраи: «неизвестный контракт» отвечаем 200 (иначе 20 бессмысленных повторов), транзиентные ошибки БД — 5xx. Смена `LAVATOP_WEBHOOK_SECRET` требует одновременной правки в ЛК Lava и Vercel env.
