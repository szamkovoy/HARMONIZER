---
id: 02_modules/account_web/spec
title: Account Web (Личный кабинет) Spec
version: 1.10
updated: 2026-07-22
depends_on: [02_modules/subscription/spec, 02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/account/index.ts,
    modules/account/core/openAccountCabinet.ts,
    modules/account/core/billingCurrency.ts,
    modules/account/core/accountLinksConfig.ts,
    modules/account/core/accountFlagsStore.ts,
    modules/account/core/purchasesClient.ts,
    modules/account/ui/MembershipEventsBridge.tsx,
    modules/access/ui/AccountGateDialog.tsx,
    modules/access/ui/AccountUpsellPanel.tsx,
    _legacy_web/app/api/account/_utils.ts,
    _legacy_web/app/api/account/lava.ts,
    _legacy_web/app/api/account/yookassa.ts,
    _legacy_web/app/api/account/selectPaymentProvider.ts,
    _legacy_web/app/api/account/paymentCatalog.ts,
    _legacy_web/app/api/account/fulfillPaymentContract.ts,
    _legacy_web/app/api/account/overview-data.ts,
    _legacy_web/app/api/account/ott/route.ts,
    _legacy_web/app/api/account/session/route.ts,
    _legacy_web/app/api/account/overview/route.ts,
    _legacy_web/app/api/account/checkout/route.ts,
    _legacy_web/app/api/account/subscription/route.ts,
    _legacy_web/app/api/account/purchases/last/route.ts,
    _legacy_web/app/api/account/webhooks/lava/route.ts,
    _legacy_web/app/api/account/webhooks/yookassa/route.ts,
    _legacy_web/app/api/account/fx/,
    web_cabinet/cabinet.html,
    supabase/migrations/20260714220000_web_account_ott.sql,
    supabase/migrations/20260715120000_lava_payment_contracts.sql,
    supabase/migrations/20260718150000_payment_offers.sql,
    supabase/migrations/20260718170000_payment_contracts_one_time.sql,
    supabase/migrations/20260718173000_payment_offers_one_time.sql,
    supabase/migrations/20260718230000_fix_webinar_book_offer_ids.sql,
    supabase/migrations/20260722120000_yookassa_payment_catalog.sql,
    app/_layout.tsx,
  ]
---

> Интеграция с Lava.top — в `docs/02_modules/account_web/lava_integration.md`. ЮKassa (RUB) — §3.3 ниже.

## 1. Назначение

Мост между приложением и **внешним Личным кабинетом** на `https://zamkovoi.yoga/cabinet/` (модель Consumption-Only: вся коммерция вне приложения). Модуль отвечает за:

1. **OTT-переход** — безопасный одноразовый вход в веб-кабинет из приложения (системный браузер, не WebView).
2. **Kill-switch** кнопок «Личный кабинет» на время App Review (`app_config.account_links_enabled`).
3. **Подхват смены уровня** — Realtime на своей строке `users` + тихий foreground-refetch; модалки «Демонстрационный период завершён» и «Уровень профиля обновлён» (`MembershipEventsBridge`).
4. **Веб-страницу кабинета** — standalone HTML5 (`web_cabinet/cabinet.html` → `https://zamkovoi.yoga/cabinet/`, без WordPress); UI-словари 8 локалей в файле; оферта — `public/cabinet/offer/{lang}.json` на Vercel, только по клику.

## 2. Публичный контракт

Экспорт `modules/account/index.ts`:

- **`openAccountCabinet(ctx?: CabinetContext): Promise<void>`** — `POST /api/account/ott` (Bearer JWT приложения) → `Linking.openURL("https://zamkovoi.yoga/cabinet/?ott=…&lang=…&currency=…&ctx=…")`. Бросает ошибку при недоступности OTT (UI показывает `gate.cabinetError`). `ctx`: `"tier"` (default) | `"webinar:<id>"` | `"course:<id>"` — задел под вебинары/курсы. Перед открытием пишет флаг `cabinetVisit.{userId}` (см. `readFreshCabinetVisit`).
- **`resolveBillingCurrency(userId): Promise<"RUB"|"USD"|"EUR">`** — валюта цен кабинета по геолокации: reverse-geocode кэшированных координат (`userLocationProfileCache`) → страна → RU=RUB, US=USD, иначе EUR; fallback EUR. In-memory кэш на сессию + персистентный флаг `billingCurrency`; reverse-geocode ограничен **800 мс** (при таймауте сразу EUR, уточнение в фоне) — чтобы `openAccountCabinet` не держал белый Safari до `openURL`.
- **`getAccountCabinetUrl()`** — URL кабинета; переопределяется `EXPO_PUBLIC_ACCOUNT_CABINET_URL`.
- **`useAccountLinksEnabled(): boolean`** / **`getAccountLinksEnabled()`** — kill-switch из `app_config` (in-memory TTL 5 мин + персист последнего явного значения; fail-safe `false`). «Нет строк»/сеть/503 schema cache НЕ пишутся как свежее `false`; при ошибке — ретраи, затем прежний кэш/персист. Персист убирает мигание кнопки на Профиле, пока идёт refetch.
- **`MembershipEventsBridge`** — компонент без UI-поверхности (кроме модалок), монтируется один раз в `app/_layout.tsx` под `AuthProvider`.

Внутреннее (не экспортируется из barrel): `core/accountFlagsStore.ts` — персистентные флаги (`lastTier.{userId}`, `trialEndedShown.{userId}`) в SecureStore/localStorage.

### API `_legacy_web/app/api/account/*`

| Роут | Auth | Назначение |
| --- | --- | --- |
| `POST /api/account/ott` | Bearer JWT Supabase (приложение) | Выдаёт OTT: 32 байта base64url, в БД только sha256-хэш, TTL 5 мин |
| `POST /api/account/session` | без auth, body `{ ott }`, CORS = origin сайта | Атомарно гасит OTT (`UPDATE … WHERE used_at IS NULL`), возвращает `{ sessionToken, overview }` |
| `GET /api/account/overview` | Bearer кабинетной сессии, query `?currency=` | Свежий `overview`; цены: Lava products (USD/EUR и RUB→Lava) или `payment_catalog` (RUB→ЮKassa) |
| `POST /api/account/checkout` | Bearer кабинетной сессии, body `{ kind, tier?, webinarId?, currency }` | `selectPaymentProvider(currency)` → Lava или ЮKassa. Lava: как раньше (invoice + `provider=lavatop`). ЮKassa (RUB при флагах): pending `payment_contracts` (`provider=yookassa`, `contract_id` = наш uuid) + `POST /v3/payments` → `{ paymentUrl: confirmation_url, contractId }`. Политики kind/апгрейда те же. |
| `GET /api/account/purchases/last` | Bearer JWT Supabase (приложение) | Последняя активная one_time-покупка (`{ kind, productRef, createdAt, contractId }` | null). Приложение сверяет `createdAt` с `cabinetVisit` и благодарит за покупку (`gate.bookPaid.*`). Таблица `payment_contracts` закрыта для клиента — чтение только service role |
| `GET /api/account/subscription` | Bearer кабинетной сессии | Последний контракт со статусом active/cancelled |
| `DELETE /api/account/subscription` | Bearer кабинетной сессии | Отмена через `cancelActiveSubscriptionsForUser` (`lavatop` → Lava DELETE; `yookassa` → DB-only, автосписаний пока нет) + статус cancelled; доступ до `current_period_end` / `membership_expires_at`. |
| `DELETE /api/account/delete` | Bearer JWT Supabase (приложение) | Удаление аккаунта: (1) `cancelActiveSubscriptionsForUser` по всем провайдерам; (2) снимок `buyer_email` на `payment_contracts`/`payments`; (3) `auth.admin.deleteUser` — PII/профиль каскадом, платёжный леджер остаётся (`user_id` SET NULL). Ответ `{ deleted: true }` |
| `POST /api/account/webhooks/lava` | заголовок `X-Api-Key` = `LAVATOP_WEBHOOK_SECRET` | Приём событий Lava (см. §3.1) |
| `POST /api/account/webhooks/yookassa` | опц. `YOOKASSA_WEBHOOK_SECRET` + всегда GET payment у API | События ЮKassa (см. §3.3) |

Кабинетная сессия — компактный HMAC-SHA256 токен (`payload.sig`, TTL 60 мин, секрет `ACCOUNT_CABINET_SECRET`); прав хватает на чтение overview и операции с собственной подпиской. `AccountOverview`: как раньше; цены из активного шлюза. `purchase.mode` — `"checkout"` (POST + redirect) для Lava и ЮKassa; `"link"` — задел под внешний URL без нашего чекаута.

## 3. Внутренняя архитектура

- **БД** (`20260714220000_web_account_ott.sql`): `web_ott_tokens` (RLS без политик — только service role), `app_config` (RLS: select для authenticated, insert/update для админов; seed `account_links_enabled=true`), `users` добавлена в publication `supabase_realtime`.
- **БД** (`20260719000000_app_config_anon_read_account_links.sql`): доп. политика select на `app_config` для `anon, authenticated` с ограничением `using (key = 'account_links_enabled')`. Нужно, чтобы kill-switch читался и без активной сессии (холодный старт, окно sign-out/sign-in, протухший access_token) — иначе `useAccountLinksEnabled` кэшировал fail-safe `false` на 5 минут и кнопка «Личный кабинет» пропадала. Остальные ключи `app_config` остаются только для authenticated/админов.
- **БД** (`20260715120000_lava_payment_contracts.sql`): `payment_contracts` (user_id, contract_id unique, tier oracle|master, currency, amount, status pending|active|cancelled|failed, current_period_end, cancelled_at; RLS без политик — только service role).
- **БД** (`20260720092052_payment_ledger_survive_user_delete.sql`): `payment_contracts.user_id` и `payments.user_id` — nullable, FK `ON DELETE SET NULL`; колонка `buyer_email` (снимок email при checkout / перед deleteUser). Платёжные строки переживают удаление аккаунта для отчётов.
- **БД** (`20260718150000_payment_offers.sql`): `payment_offers` (tier, locale, offer_id, active; unique tier+locale; RLS без политик). Маппинг (tier, locale) → Lava offerId с fallback на `en`. `tier` ∈ `oracle`|`master`|`webinar`|`book`|`course:<id>`. Цены НЕ хранятся — тянутся из Lava `GET /api/v2/products?feedVisibility=ALL` (кэш 10 мин; `feedVisibility=ALL` обязателен — иначе скрытые «Доступ только по ссылке» продукты не возвращаются). См. `lava_integration.md` §3.
- **БД** (`20260718170000_payment_contracts_one_time.sql`): `payment_contracts` расширена колонками `product_kind` (subscription|one_time) и `product_ref` (для webinar = webinar_id); `tier` — `oracle`|`master`|`webinar`|`book`; `periodicity` — `MONTHLY`|`ONE_TIME`.
- **БД** (`20260718173000_payment_offers_one_time.sql`): seed `webinar/en`, `book/en` (изначально productId — ошибочно).
- **БД** (`20260718230000_fix_webinar_book_offer_ids.sql`): `UPDATE` `webinar/en`, `book/en` → настоящие offerId из `GET /api/v2/products?feedVisibility=ALL` (`offers[].id`); productId ≠ offerId.
- **БД** (`20260722120000_yookassa_payment_catalog.sql`): `payment_catalog` (SKU ЮKassa/RUB: oracle 950, master 4950, webinar 950, book 1500); на `payment_contracts` — `provider_payment_id`, `payment_method_id`; таблица `yookassa_payment_methods` (задел рекуррента). RLS без политик — service role.
- **`MembershipEventsBridge`**: (а) Realtime UPDATE своей строки `users` → `refreshProfile()`; (б) foreground — выборка membership-полей и `refreshProfile()` только при изменении отпечатка; (в) сравнение `baseTierFromRow` с сохранённым `lastTier` → модалка повышения уровня («{from} → {to}», `gate.tierChanged.*`); (г) `trial_expires_at` в прошлом при free-базе → одноразовая модалка `gate.trialEnded.*` (кнопки «Закрыть» / «Личный кабинет»); (д) foreground-проверка последней one_time-покупки через `GET /api/account/purchases/last` при **любом** ctx визита в кабинет (профиль, карточка вебинара, апселл) → если это вебинар или книга, оплаченные после `cabinetVisit.ts`, модалка `gate.webinarPaid.*` / `gate.bookPaid.*` (ретрай 10с на задержку вебхука; флаг `purchaseThanksShown.<uid>.<contractId>`; visit чистится только после показа). Раньше вебинар детектился только при `ctx=webinar:<id>` — оплата из профиля не давала модалки.
- **Страница кабинета** (`web_cabinet/cabinet.html`): standalone HTML5. Перед redirect на оплату кладёт кабинетную сессию в `sessionStorage` (чтобы вернуться с `?paid=1` без OTT). При `?paid=1` — блок «Спасибо за оплату» (8 локалей). **Деплой страницы:** ISPManager `https://zamkovoi.yoga/cabinet/` без WP; Vercel — API + `offer/*.json`.

### 3.1 Поток оплаты Lava.top

1. Кабинет: `hzStartUpgrade(tier,purchase)` / `hzStartWebinar(purchase)` / `hzStartBook(purchase)` → `POST /api/account/checkout { kind, tier|webinarId, currency }` → строка `payment_contracts` (pending) → redirect на `paymentUrl` Lava.
2. Вебхуки (`POST /api/account/webhooks/lava`, тело `{ eventType, contractId, parentContractId?, buyer{email}, amount, currency, status, timestamp }`):
   - `payment.success` (subscription) — контракт → active, `current_period_end = +30 дней`; `users.membership_tier = tier`, `membership_expires_at = period_end + 48ч грейс`; все прочие active-контракты пользователя отменяются в Lava и в БД (политика A3); затем settlement (см. §3.2).
   - `payment.success` (one_time, tier=webinar) — контракт → active; `membership_*` НЕ трогается; upsert `webinar_registrations(webinar_id=product_ref, user_id)`; settlement.
   - `payment.success` (one_time, tier=book) — контракт → active; `membership_*` и регистрации НЕ трогаются; приложение благодарит через `purchases/last`; settlement.
   - `payment.failed` — pending → failed;
   - `subscription.recurring.payment.success` — сдвиг периода и `membership_expires_at` (ключ — `parentContractId`) + settlement на сумму вебхука;
   - `subscription.recurring.payment.failed` — только лог (Lava ретраит сама);
   - `subscription.cancelled` — контракт → cancelled; `users.membership_*` не трогаем — доступ живёт до `membership_expires_at`, дальше `paidAccess` вернёт free.
   Неизвестный контракт — ответ 200 (ретраи бессмысленны), транзиентная ошибка БД — 5xx (Lava повторит, до 20 попыток). Сбой FX/settlement логируется, но **не** валит активацию (ответ всё равно 2xx).
3. Подхват в приложении — Realtime/foreground `MembershipEventsBridge` (модалка «Уровень профиля обновлён»); для вебинара — `WebinarScreen` повторно проверяет `isRegistered` в foreground + модалка «Вы записаны на вебинар» (`gate.webinarPaid.*`); для книги — `purchases/last` + модалка «Спасибо за покупку книги» (`gate.bookPaid.*`).
4. Даунгрейд = отмена + новая подписка после конца периода (в кабинете после отмены показываются все платные уровни).

### 3.2 Settlement / FX (net в ₽ / € / $)

На каждый успешный charge (`payment.success` и renewal) сервер (`_legacy_web/app/api/account/fx/`):

1. Берёт gross `amount` + `currency` из вебхука (fallback — поля контракта).
2. Вычитает комиссию эквайринга: Lava **8%** (`LAVA_GATEWAY_FEE_RATE`, default `0.08`); ЮKassa / Яндекс **2.5%** (`YANDEX_GATEWAY_FEE_RATE`, provider `yookassa`).
3. Конвертирует остаток в `net_amount_rub` / `net_amount_eur` / `net_amount_usd` по buy/sell:
   - иностранная → RUB: курс **покупки** банком (`buy`);
   - RUB → иностранная: курс **продажи** клиенту (`sell`);
   - USD ↔ EUR: **прямой** курс банка, иначе через RUB;
   - та же валюта: курс = 1 (только комиссия).
4. Источник котировок: **Т-Банк** (`DebitCardsOperations`) → **ЦБ РФ**. При коммерческом курсе 2% не вычитаются; при fallback на ЦБ итог × **0,98**. Округление `round` до 2 знаков. Курс кэшируется **на московный день (Europe/Moscow)** в `fx_daily_quotes`: внешний запрос не чаще раза в сутки. Если Т-Банк в этот день не ответил — до завтра только ЦБ (без повторных попыток к Т-Банку).
5. Пишет строку в `payment_settlements` (идемпотентно) и зеркалит nets на `payment_contracts` (latest). Миграция `20260722020000_payment_settlements_fx_nets.sql`.

### 3.3 ЮKassa (RUB)

Маршрутизация (`selectPaymentProvider`):

```
currency === "RUB"
  && YOOKASSA_ENABLED === "true"
  && PAYMENT_GATEWAY_FOR_RUB === "yookassa"   # default lavatop
→ yookassa
иначе → lavatop
```

USD/EUR всегда Lava. Выключение — env без деплоя кода.

1. Overview для RUB+ЮKassa берёт цены из `payment_catalog` (не Lava feed).
2. Checkout: pending contract (`contract_id` = uuid) → `POST https://api.yookassa.ru/v3/payments` (Basic `shopId:secret`, `capture:true`, `confirmation.redirect`, `return_url=YOOKASSA_RETURN_URL`, metadata `{contractId,userId,tier,kind,webinarId?}`, Idempotence-Key = contractId). Подписки: `payment_method_data.type=bank_card`; разовые — Умный платёж. При `YOOKASSA_RECURRING_ENABLED=true` — ещё `save_payment_method` (сейчас false: доступ = 30 дней grant без автосписания).
3. Webhook `payment.succeeded`: GET payment у API → `fulfillFirstPaymentSuccess` (membership +30d+48h grace / webinar upsert / book) + `settlePayment(..., provider:'yookassa')`. `payment.canceled` → pending→failed. Идемпотентность по active contract / settlement.
4. Чеки 54-ФЗ в первом релизе **не** передаём. Cron рекуррента — вне этого релиза; поля `payment_method_id` / `yookassa_payment_methods` уже есть.
5. Return: `YOOKASSA_RETURN_URL` (напр. `https://zamkovoi.yoga/cabinet/?paid=1`) — thanks в кабинете + подсказка вернуться в приложение.

**Runbook:** миграция `20260722120000` → env на Vercel → в кабинете ЮKassa HTTP-уведомления на `https://harmonizer-ten.vercel.app/api/account/webhooks/yookassa` (`payment.succeeded`, `payment.canceled`) → smoke-тест одного RUB платежа.

## 4. Конфигурация

- Vercel env (Lava): `ACCOUNT_CABINET_SECRET`, `ACCOUNT_CABINET_ALLOWED_ORIGIN` (default `https://zamkovoi.yoga`), `LAVATOP_API_KEY`, `LAVATOP_WEBHOOK_SECRET`, `LAVATOP_TARIFF_2_ID`, `LAVATOP_TARIFF_3_ID`. Опционально: `LAVA_GATEWAY_FEE_RATE`, `YANDEX_GATEWAY_FEE_RATE`.
- Vercel env (ЮKassa): `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_RETURN_URL`, `YOOKASSA_ENABLED` (`true`/`false`), `PAYMENT_GATEWAY_FOR_RUB` (`lavatop`\|`yookassa`), `YOOKASSA_RECURRING_ENABLED` (`false` до включения автоплатежей в магазине), опц. `YOOKASSA_WEBHOOK_SECRET`.
- Приложение: `EXPO_PUBLIC_ACCOUNT_CABINET_URL` (default `https://zamkovoi.yoga/cabinet/`).
- Страница: константа `API_BASE` в `cabinet.html` (origin Vercel); оферта — `{API_BASE}/cabinet/offer/{lang}.json`.
- Kill-switch: `update app_config set value='false' where key='account_links_enabled'` перед отправкой сборки на ревью; `'true'` после прохождения. Без релиза приложения (кэш клиента — до 5 минут). Ключ `account_links_enabled` читается и анонимом (политика `20260719000000`), остальные ключи `app_config` — только для authenticated/админов.

## 5. Комплаенс-политика текстов (инвариант)

Внутри приложения запрещены: цены, «купить/оплатить/тариф/подписка/скидка», ссылки на платёжные страницы, WebView с оплатой. Разрешено: нейтральные «уровень профиля», «расширенные возможности учётной записи», кнопка «Личный кабинет» (системный браузер). Все тексты точек гейтинга — `gate.*` в i18n-каталоге; ревизия новых строк на запрещённые формулировки обязательна. На сайте (внешний веб) ограничений сторов нет.

## 6. Текущее состояние и планируемое

Реализовано: OTT-цепочка, kill-switch, Realtime/foreground-подхват, модалки, оплата через Lava.top (USD/EUR и RUB по умолчанию) и ЮKassa для RUB при env-флагах (30-дневный grant без автосписания; задел `YOOKASSA_RECURRING_ENABLED`), разовая оплата вебинара/книги, отмена подписки, цены по геовалюте, `purchase.mode=checkout` для обоих шлюзов. Планируется: читалка книги; курсы/интенсивы; годовая периодичность Lava; включение рекуррента ЮKassa (менеджер магазина + флаг + cron); чеки 54-ФЗ.
