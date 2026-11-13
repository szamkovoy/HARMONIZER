---
id: 02_modules/account_web/lava_integration
title: Lava.top Payment Integration
version: 1.8
updated: 2026-11-13
depends_on: [02_modules/account_web/spec, 02_modules/subscription/spec, 02_modules/i18n/spec]
code_refs:
  [
    _legacy_web/app/api/account/lava.ts,
    _legacy_web/app/api/account/checkout/route.ts,
    _legacy_web/app/api/account/subscription/route.ts,
    _legacy_web/app/api/account/purchases/last/route.ts,
    _legacy_web/app/api/account/webhooks/lava/route.ts,
    _legacy_web/app/api/account/lavaReconcile.ts,
    _legacy_web/app/api/cron/lava-reconcile/route.ts,
    _legacy_web/app/api/account/overview-data.ts,
    modules/account/core/purchasesClient.ts,
    web_cabinet/cabinet/index.html,
    supabase/migrations/20260715120000_lava_payment_contracts.sql,
    supabase/migrations/20260718150000_payment_offers.sql,
    supabase/migrations/20260718170000_payment_contracts_one_time.sql,
    supabase/migrations/20260718173000_payment_offers_one_time.sql,
    supabase/migrations/20260718230000_fix_webinar_book_offer_ids.sql,
  ]
---

## 1. Назначение

Интеграция внешнего платёжного провайдера **Lava.top** для подписок «Наставник» (oracle) и «Мастер» (master) в модели Consumption-Only: оплата проходит на стороне Lava (редирект из Личного кабинета), приложение только потребляет результат через БД. Документ фиксирует контракт API Lava, маппинг локализованных продуктов, правило валют, поток вебхуков и политики апгрейда/отмены.

## 2. Контракт с Lava.top (внешний)

Базовый URL: `https://gate.lava.top`. Авторизация — заголовок `X-Api-Key: $LAVATOP_API_KEY`.

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/v2/invoice` | Создание инвойса (первый платёж по подписке). Body: `{ email, offerId, currency, periodicity, buyerLanguage, successful_return_url?, failure_return_url?, cancel_return_url?, paymentMethod? }` (`paymentMethod`: `UNLIMINT` карта по умолчанию для EUR/USD, `PAYPAL`; для RUB не передаём). Ответ: `{ id, status, amountTotal, paymentUrl }`. `id` = contractId (он же `parentContractId` рекуррентных платежей). |
| GET | `/api/v2/products?feedVisibility=ALL&limit=100` | Список продуктов с офферами и ценами. Источник правды для цен. **`feedVisibility=ALL` обязателен**: по умолчанию возвращаются только продукты, видимые в общей ленте, а разовые товары (вебинар/книга) опубликованы как «Доступ только по ссылке» и без параметра не попадают в ответ. Ответ: `{ items: [{ id, title, description, offers: [{ id, name, prices: [{ currency, amount, periodicity }] }] }] }`. Кэшируется сервером 10 мин. |
| DELETE | `/api/v1/subscriptions?contractId=&email=` | Отмена подписки. 404 = уже отменена (не ошибка для нас). |

Вебхуки (настроены в ЛК автора, два эндпоинта на `POST /api/account/webhooks/lava`): «Результат платежа» (`payment.success`/`payment.failed`) и «Регулярный платёж» (`subscription.recurring.payment.success`/`.failed`, `subscription.cancelled`). Аутентификация вебхука — заголовок `X-Api-Key: $LAVATOP_WEBHOOK_SECRET`. Тело: `{ eventType, contractId, parentContractId?, buyer{email}, amount, currency, status, timestamp, errorMessage?, product{id,title} }`. Lava ретраит доставку до 20 раз, пока не получит 2xx.

URL вебхуков в ЛК Lava: `https://harmonizer.zamkovoi.yoga/api/account/webhooks/lava` (PHP-прокси REG.RU, см. `DEPLOY.md` «Russia proxy»), не `harmonizer-ten.vercel.app`. Отправитель вебхуков Lava сидит в российской сети: `harmonizer-ten.vercel.app` резолвится в `*.131`, на которых TLS из РФ зависает. 06.11 все 20 попыток доставки успешной оплаты ушли в TIMEOUT/BLOCKED и ни одна не дошла до кода. BLOCKED — пауза самой Lava после серии таймаутов.

Ответ вебхука уходит сразу после записи оплаты. Письмо и расчёт комиссии дописываются после ответа, потому что Lava ждёт не дольше 10 секунд.

Если вебхук так и не обновил строку, планировщик раз в 10 минут проверяет только pending-счета Lava возрастом 10–22 минуты и только их спрашивает у `GET /api/v1/invoices/{id}`. Пустой список наружу не уходит. Дальше тот же счёт уже не проверяется.

`buyerLanguage` (EN/RU/ES) локализует **только хром интерфейса** Lava (кнопки, подписи). Название и описание продукта — фиксированы автором при создании продукта. Поэтому полная локализация страницы оплаты требует отдельного продукта Lava на каждый язык (см. §3).

## 3. Мультиязычность продуктов

Lava не поддерживает несколько языков у одного продукта: `title`/`description` продукта и `name` оффера автор задаёт на одном языке. Стратегия (решение продукта 2026-07-18):

- **Один продукт Lava на язык**, содержащий офферы всех тарифов с локализованными `name` и ценами.
- **Маппинг (tier, locale) → offerId** живёт в таблице `payment_offers` (Supabase). `tier` ∈ `oracle` | `master` | `webinar:<id>` | `course:<id>` (задел под вебинары/курсы). Цены здесь НЕ хранятся — тянутся из `GET /api/v2/products`.
- **Fallback на локаль `en`**: если в `payment_offers` нет строки для локали пользователя, берётся `en`. Поэтому запуск возможен с одного английского продукта; добавление языка = создание продукта в Lava + 2 строки в `payment_offers`, **без правки кода**.
- **Валюта независима от языка продукта**: RU-язычный пользователь в Германии покупает RU-язычный продукт, но платит в EUR (гео). Один оффер Lava поддерживает цены во всех трёх валютах.

Текущий seeded-маппинг (все под локаль `en`): `oracle`, `master` → offerId продукта «Subscription zamkovoi»; `webinar` (Консультация) и `book` (Цифровой продукт) → настоящие offerId (см. §3.1). Когда автор создаст чистые локализованные продукты, `offer_id` в строках обновляется `UPDATE` без миграции.

### 3.1 Где взять offerId

`offerId` ≠ `productId` (то, что в URL `app.lava.top/products/<productId>`). Для подписок и для разовых товаров (Консультация/Цифровой продукт/Курс) offerId — это ID конкретного оффера. Два способа получить его:

- **API (используется сервером):** `GET /api/v2/products?feedVisibility=ALL` → `items[].offers[].id` + `offers[].prices`. `feedVisibility=ALL` обязательно, иначе скрытые «Доступ только по ссылке» продукты (вебинар/книга) не возвращаются. Цены берутся отсюда же — единообразие, цены не дублируются в БД.
- **UI Lava (для ручной проверки):** открыть страницу продукта в режиме инкогнито → нажать «Купить» → URL редиректа `app.lava.top/products/<productId>/<offerId>?currency=…` — второй UUID это offerId.

«Цена по запросу API» (`/api/v3/invoice` с `amount` от клиента) **не используется**: разовые товары публикуются с фиксированными ценами в карточках Lava, оплата идёт через `POST /api/v2/invoice` (ONE_TIME), цены тянутся из карточек.

## 4. Правило валюты

Валюта/страна — `resolveBillingGeo` (`billingCurrency.ts`): сначала `users.country_code` (только GPS/Nominatim), иначе эфемерный IP. RU → RUB (+ ЮKassa), US → USD, иначе EUR (+ Lava INT). В кабинет: `?currency=` + `?country=`. IP не пишется в `users.country_code`. Timeout не залипает как EUR в SecureStore.

**Российский эквайринг:** в ближайшее время подключается Яндекс.Касса/Сбер для РФ. До этого RU-пользователи идут через Lava (английский продукт, оплата в RUB) — для тестирования. Переключатель «Lava ↔ российский эквайринг» заложить как тестовый тумблер (open question).

## 5. Поток оплаты

### 5.1 Подписка на тариф (MONTHLY)

1. Кабинет: `hzStartUpgrade(tier, purchase)` → `POST /api/account/checkout { kind:"subscription", tier, currency }`.
2. Сервер: `resolveLavaOfferId(db, tier, userLocale)` (fallback en) → `POST /api/v2/invoice` (MONTHLY) → строка `payment_contracts` (pending, product_kind=subscription) → ответ `{ paymentUrl, contractId }`.
3. Кабинет: redirect на `paymentUrl` Lava. По `visibilitychange` (возврат с оплаты) — `GET /api/account/overview?currency=` и перерисовка.
4. Вебхук `payment.success` идёт только через `fulfillFirstPaymentSuccess` (общий с ЮKassa): контракт active, `users.membership_tier/expires_at` обновлены (период 30 дней + 48ч грейс), прежние active-подписки пользователя отменены в Lava и БД (политика A3); параллельно `settlePayment` пишет net в `payment_settlements` (см. `spec.md` §3.2). Повторный вебхук по уже active-контракту довыдаёт доступ, если в `users` срок короче оплаченного.
5. Приложение подхватывает смену уровня через Realtime/foreground (`MembershipEventsBridge`).

### 5.1a Отказ банка и 30 дней без автопродления

Подписка сохраняет карту, и банк требует полный 3‑D Secure. Карты без него (или неверный код) дают `payment.failed` с `errorMessage: "Declined by 3-D Secure"`, хотя разовые платежи той же карты проходят. Поэтому счёт тарифа из кабинета передаёт `failure_return_url` = `https://harmonizer.zamkovoi.yoga/pay/failed?t=<токен>`: Lava сразу возвращает человека на страницу «Оплата не удалась» с кнопками «Оплатить другой картой», «Оплатить через PayPal» (EUR/USD) и «Оплатить 30 дней без автопродления». Кнопка создаёт новый счёт на тот же email и открывает форму Lava без повторного ввода данных. 30 дней — отдельные разовые продукты Lava «Гармонизатор (тариф Наставник)» (`oracle_30d`, оффер `8df24276-c186-4637-a89a-3e4bf85bc0b6`) и «Гармонизатор (тариф Мастер)» (`master_30d`, оффер `dba6b70c-8222-4cf6-b5e8-6c725132e994`). Подробно — `spec.md` §3.5. `errorMessage` сохраняется в `payment_contracts.failure_reason`.

### 5.2 Разовая оплата вебинара (ONE_TIME)

1. Кабинет: `hzStartWebinar(purchase)` → `POST /api/account/checkout { kind:"webinar", webinarId?, currency }`. `webinarId` берётся из `ctx=webinar:<id>` (пришёл из приложения с экрана вебинара); если нет — ближайший опубликованный вебинар.
2. Сервер: проверка что вебинар опубликован и пользователь ещё не записан (иначе `{alreadyRegistered:true}`); `resolveLavaOfferIdByName(db,"webinar",userLocale)` → `POST /api/v2/invoice` (ONE_TIME) → строка `payment_contracts` (pending, product_kind=one_time, tier=webinar, product_ref=<webinarId>).
3. Кабинет: redirect на `paymentUrl` Lava.
4. Вебхук `payment.success` для one_time webinar: контракт active, `membership_*` НЕ трогается, upsert `webinar_registrations(webinar_id=product_ref, user_id)`.
5. Приложение: `WebinarScreen` при возврате в foreground повторно проверяет `isRegistered` (экран обновляется: «Записаться» → «Вы записаны» + ссылка); `MembershipEventsBridge` показывает модалку «Вы записаны на вебинар» (`gate.webinarPaid.*`) при обнаружении последней one_time-покупки `kind=webinar` через `GET /api/account/purchases/last` после визита в кабинет с **любым** ctx (ретрай 10с на случай задержки вебхука). Кнопки «Отменить запись» на экране вебинара нет.

### 5.4 Разовая покупка книги (ONE_TIME)

1. Кабинет: `hzStartBook(purchase)` → `POST /api/account/checkout { kind:"book", currency }`.
2. Сервер: `resolveLavaOfferIdByName(db,"book",userLocale)` → `POST /api/v2/invoice` (ONE_TIME) → строка `payment_contracts` (pending, product_kind=one_time, tier=book, product_ref=null).
3. Кабинет: redirect на `paymentUrl` Lava.
4. Вебхук `payment.success` для one_time book: контракт → active; `membership_*` и регистрации НЕ трогаются.
5. Приложение: на foreground после визита в кабинет (с **любым** ctx) `MembershipEventsBridge` зовёт `GET /api/account/purchases/last` (Bearer JWT, service role — `payment_contracts` закрыта для клиента), сверяет `createdAt` покупки с `cabinetVisit.ts` и показывает модалку «Спасибо за покупку книги» (`gate.bookPaid.*`, ретрай 10с; флаг `purchaseThanksShown.<uid>.<contractId>`). Тот же механизм детектит и вебинар (`kind=webinar` → `gate.webinarPaid.*`). Читалка книги в приложении — следующий этап (покупка уже фиксируется в БД).

### 5.5 Провайдер-абстракция (задел под RU-эквайринг)

`AccountOverview.*.purchase = { mode:"checkout"|"link", price, url }`. Кабинет не знает провайдера:
- `mode:"checkout"` → `POST /api/account/checkout` + redirect на `paymentUrl` (сейчас Lava);
- `mode:"link"` → `window.location = url` (внешний URL российского эквайринга).

Решение провайдера — `resolvePurchaseMode(currency)` в `overview-data.ts`. Сейчас всегда `"checkout"`. Переключение на RU-эквайринг для RUB = новая ветка там + url из env, **без правки кабинета**.

## 6. Политики апгрейда/отмены

- **Апгрейд (A3, решение 2026-07-15):** немедленно, без пересчёта остатка. Новый контракт активируется сразу, старая active-подписка отменяется сервером (остаток периода — в пользу автора). В кабинете — пояснение `upgradeNote`: «Новый уровень активируется сразу; стоимость текущего периода не пересчитывается».
- **Даунгрейд:** только через отмену (доступ до конца периода) + новую подписку после. Checkout отклоняет уровень ≤ текущего (409), только если подписка действует: `status = active` и `current_period_end + 48ч > now()`.
- **Продление не прошло:** `subscription.recurring.payment.failed` терминален. Контракт → `cancelled`, `failure_reason` = `renewal: …`. Доступ в `users` не снимается этим событием. После ответа — отмена в Lava и письмо покупателю (доступ до `current_period_end`, кнопка `/pay/renew`, язык `users.locale`). Страховочно `lapse_stale_subscriptions()` (миграция `20261113090000`) закрывает active-подписку, у которой период кончился больше 72ч назад; эта зачистка писем не шлёт.
- **Журнал:** принятое событие пишется в `payment_events` после ответа. `FAILED` сверки ставит `failure_reason` = `reconcile: invoice FAILED`. Письмо админу (`PAYMENT_ALERT_EMAIL`) уходит на `payment.failed`, отказ продления и `FAILED` сверки, один раз на контракт и тип события. У отказа продления ЮKassa в ключ входит ещё дата по Москве.
- **Отказ первой оплаты:** тот же cron раз в 10 минут после сверки шлёт покупателю письмо, если отказ тарифа (подписка или 30 дней) старше 30 минут и младше суток. Postgres не зовёт Vercel, когда нет ни зависшего счёта, ни такого кандидата. Миграция `20261113140000`.
- **Отмена:** `DELETE /api/account/subscription` → `DELETE /api/v1/subscriptions` в Lava + статус cancelled. `users.membership_*` не трогаем — доступ живёт до `membership_expires_at`, дальше `paidAccess` вернёт free. В кабинете — текст «доступ сохранится до конца оплаченного периода».

## 7. Конфигурация (env)

| Переменная | Назначение |
| --- | --- |
| `LAVATOP_API_KEY` | Авторизация API-вызовов к Lava. |
| `LAVATOP_WEBHOOK_SECRET` | Проверка заголовка `X-Api-Key` вебхука. Смена = синхронная правка в ЛК Lava. |
| `LAVATOP_TARIFF_2_ID` / `LAVATOP_TARIFF_3_ID` | (Legacy) изначальные offerId Advisor/Master. После `payment_offers` не используются сервером — маппинг берётся из БД. Оставлены для совместимости/бэкапа. |
| `PAYMENT_ALERT_EMAIL` | Письмо о сбое оплаты. Нет переменной — письмо пропускается. |

offerId не секретны; хранятся в `payment_offers` (БД), не в env. Цены — из Lava, не в коде/БД.

## 8. Документация Lava (внешние ссылки)

- Главная: https://developers.lava.top/ru
- Рекуррентные платежи: https://developers.lava.top/ru#как-создать-рекуррентный-платёж
- FAQ: https://faq.lava.top/article/67353 , https://faq.lava.top/article/76482 , https://faq.lava.top/article/79240
- SDK (контракт сверен): npm `lava-top-sdk`, pypi `lava-top-sdk`.

## 9. Открытые вопросы

- ~~Разовая оплата вебинара~~ — реализовано (ONE_TIME, `kind:"webinar"`, `product_ref=webinarId`, регистрация вебхуком).
- ~~Прямая покупка книги через checkout~~ — реализовано (ONE_TIME, `kind:"book"`, `product_ref=null`, модалка благодарности через `purchases/last`). Читалка книги в приложении (чтение с любого устройства + скачивание файла) — следующий этап; покупка уже фиксируется в БД.
- Курсы/интенсивы: в кабинете — комбобокс «Месячный интенсив» (m1..m7) с кнопкой «Подробнее» → внешние ссылки `https://zamkovoi.yoga/m1..m7`. Прямая покупка курсов через Lava — задел (`tier=course:<id>`).
- Годовая периодичность: в Lava включить цену «Год» в оффере; добавить выбор месяц/год в кабинете + `periodicity` в checkout.
- Ответ поддержки Lava о параллельных активных контрактах одного клиента на разных офферах (наша механика уже отменяет старую подписку при активации новой).
- Переключатель «Lava ↔ российский эквайринг»: заложен как `purchase.mode` (`checkout`/`link`) в `overview`; остаётся тестовый тумблер + url из env для `mode:"link"` при `currency==="RUB"`.
- **Lava-блокер (решён 2026-07-18):** продукты вебинара («Консультация») и книги («Цифровой продукт») опубликованы в Lava с фиксированными ценами и признаком «Доступ только по ссылке». Настоящие offerId получены через `GET /api/v2/products?feedVisibility=ALL` и заполнены в `payment_offers` миграцией `20260718230000_fix_webinar_book_offer_ids`. Оплата идёт через `POST /api/v2/invoice` (ONE_TIME), цены — из карточек Lava (без «Цена по запросу API» и без дублирования цен в БД). Ближайший вебинар в `webinars` (future `starts_at`, `is_published`) всё ещё нужен, иначе блок вебинара скрыт.
