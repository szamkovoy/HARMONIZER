---
id: 02_modules/account_web/spec
title: Account Web (Личный кабинет) Spec
version: 1.6
updated: 2026-07-19
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
    _legacy_web/app/api/account/overview-data.ts,
    _legacy_web/app/api/account/ott/route.ts,
    _legacy_web/app/api/account/session/route.ts,
    _legacy_web/app/api/account/overview/route.ts,
    _legacy_web/app/api/account/checkout/route.ts,
    _legacy_web/app/api/account/subscription/route.ts,
    _legacy_web/app/api/account/purchases/last/route.ts,
    _legacy_web/app/api/account/webhooks/lava/route.ts,
    web_cabinet/cabinet.html,
    supabase/migrations/20260714220000_web_account_ott.sql,
    supabase/migrations/20260715120000_lava_payment_contracts.sql,
    supabase/migrations/20260718150000_payment_offers.sql,
    supabase/migrations/20260718170000_payment_contracts_one_time.sql,
    supabase/migrations/20260718173000_payment_offers_one_time.sql,
    supabase/migrations/20260718230000_fix_webinar_book_offer_ids.sql,
    app/_layout.tsx,
  ]
---

> Интеграция с Lava.top (контракт API, маппинг локализованных продуктов, правило валют, поток вебхуков, политики апгрейда/отмены) — в `docs/02_modules/account_web/lava_integration.md`.

## 1. Назначение

Мост между приложением и **внешним Личным кабинетом** на `https://zamkovoi.yoga/cabinet/` (модель Consumption-Only: вся коммерция вне приложения). Модуль отвечает за:

1. **OTT-переход** — безопасный одноразовый вход в веб-кабинет из приложения (системный браузер, не WebView).
2. **Kill-switch** кнопок «Личный кабинет» на время App Review (`app_config.account_links_enabled`).
3. **Подхват смены уровня** — Realtime на своей строке `users` + тихий foreground-refetch; модалки «Демонстрационный период завершён» и «Уровень профиля обновлён» (`MembershipEventsBridge`).
4. **Веб-страницу кабинета** — самодостаточный HTML+JS-блок для WordPress (`web_cabinet/cabinet.html`, 8 локалей зашиты в файл).

## 2. Публичный контракт

Экспорт `modules/account/index.ts`:

- **`openAccountCabinet(ctx?: CabinetContext): Promise<void>`** — `POST /api/account/ott` (Bearer JWT приложения) → `Linking.openURL("https://zamkovoi.yoga/cabinet/?ott=…&lang=…&currency=…&ctx=…")`. Бросает ошибку при недоступности OTT (UI показывает `gate.cabinetError`). `ctx`: `"tier"` (default) | `"webinar:<id>"` | `"course:<id>"` — задел под вебинары/курсы. Перед открытием пишет флаг `cabinetVisit.{userId}` (см. `readFreshCabinetVisit`).
- **`resolveBillingCurrency(userId): Promise<"RUB"|"USD"|"EUR">`** — валюта цен кабинета по геолокации: reverse-geocode кэшированных координат (`userLocationProfileCache`) → страна → RU=RUB, US=USD, иначе EUR; fallback EUR. Кэш на сессию.
- **`getAccountCabinetUrl()`** — URL кабинета; переопределяется `EXPO_PUBLIC_ACCOUNT_CABINET_URL`.
- **`useAccountLinksEnabled(): boolean`** / **`getAccountLinksEnabled()`** — kill-switch из `app_config` (кэш 5 мин; fail-safe: при ошибке чтения — `false`, кнопки скрыты). «Нет строк» и сетевая ошибка НЕ кэшируются как свежее `false` — кэшируется только явное значение, иначе возвращается прежний кэш без продления TTL (защита от отравления кэша транзиентным сбоем — холодный старт/окно sign-out/sign-in/протухший token).
- **`MembershipEventsBridge`** — компонент без UI-поверхности (кроме модалок), монтируется один раз в `app/_layout.tsx` под `AuthProvider`.

Внутреннее (не экспортируется из barrel): `core/accountFlagsStore.ts` — персистентные флаги (`lastTier.{userId}`, `trialEndedShown.{userId}`) в SecureStore/localStorage.

### API `_legacy_web/app/api/account/*`

| Роут | Auth | Назначение |
| --- | --- | --- |
| `POST /api/account/ott` | Bearer JWT Supabase (приложение) | Выдаёт OTT: 32 байта base64url, в БД только sha256-хэш, TTL 5 мин |
| `POST /api/account/session` | без auth, body `{ ott }`, CORS = origin сайта | Атомарно гасит OTT (`UPDATE … WHERE used_at IS NULL`), возвращает `{ sessionToken, overview }` |
| `GET /api/account/overview` | Bearer кабинетной сессии, query `?currency=` | Свежий `overview` (обновление после оплаты); `upgradeTiers[].price` — цены из Lava в запрошенной валюте |
| `POST /api/account/checkout` | Bearer кабинетной сессии, body `{ kind, tier?, webinarId?, currency }` | Создаёт инвойс Lava. `kind:"subscription"` (default) — MONTHLY-инвойс тарифа (`resolveLavaOfferId`, fallback `en`) + `payment_contracts` (pending, product_kind=subscription); при активной подписке разрешён только уровень выше (409). `kind:"webinar"` — ONE_TIME-инвойс вебинара (`webinarId` из body или ближайший опубликованный; `resolveLavaOfferIdByName(db,"webinar",locale)`); если уже записан — `{alreadyRegistered:true}`; `payment_contracts` (pending, product_kind=one_time, tier=webinar, product_ref=webinarId). `kind:"book"` — ONE_TIME-инвойс книги (`resolveLavaOfferIdByName(db,"book",locale)`); `payment_contracts` (pending, product_kind=one_time, tier=book, product_ref=null). Ответ `{ paymentUrl, contractId, webinarId? }` |
| `GET /api/account/purchases/last` | Bearer JWT Supabase (приложение) | Последняя активная one_time-покупка (`{ kind, productRef, createdAt, contractId }` | null). Приложение сверяет `createdAt` с `cabinetVisit` и благодарит за покупку (`gate.bookPaid.*`). Таблица `payment_contracts` закрыта для клиента — чтение только service role |
| `GET /api/account/subscription` | Bearer кабинетной сессии | Последний контракт со статусом active/cancelled |
| `DELETE /api/account/subscription` | Bearer кабинетной сессии | Отмена подписки в Lava (`DELETE /api/v1/subscriptions?contractId&email`) + статус cancelled; доступ у пользователя остаётся до `current_period_end`. Ответ `{ cancelled, accessUntil }` |
| `POST /api/account/webhooks/lava` | заголовок `X-Api-Key` = `LAVATOP_WEBHOOK_SECRET` | Приём событий Lava (см. §3.1) |

Кабинетная сессия — компактный HMAC-SHA256 токен (`payload.sig`, TTL 60 мин, секрет `ACCOUNT_CABINET_SECRET`); прав хватает на чтение overview и операции с собственной подпиской. `AccountOverview`: `displayName`, `email`, `registeredAt`, `locale`, `tier` (practitioner наружу отдаётся как `oracle`), `trialActive/-ExpiresAt`, `membershipExpiresAt`, `upgradeTiers` (массив `{ tier, purchase: { mode:"checkout"|"link", price:{amount,currency}|null, url:string|null } }` — уровни выше текущего с ценами из Lava в валюте `?currency=`; после отмены подписки — все платные), `subscription` (`contractId`, `tier`, `currency`, `amount`, `status active|cancelled`, `currentPeriodEnd`, `cancelledAt`; null без оплат), `webinar` (`{ webinarId, purchase }` — ближайший опубликованный вебинар + цена ONE_TIME; `webinarId=null` если ближайшего нет — кабинет скрывает блок), `book` (`{ purchase }` — цена ONE_TIME книги). `purchase.mode` — провайдер-абстракция: `"checkout"` (Lava, POST + redirect) сейчас; `"link"` (внешний URL) — задел под российский эквайринг.

## 3. Внутренняя архитектура

- **БД** (`20260714220000_web_account_ott.sql`): `web_ott_tokens` (RLS без политик — только service role), `app_config` (RLS: select для authenticated, insert/update для админов; seed `account_links_enabled=true`), `users` добавлена в publication `supabase_realtime`.
- **БД** (`20260719000000_app_config_anon_read_account_links.sql`): доп. политика select на `app_config` для `anon, authenticated` с ограничением `using (key = 'account_links_enabled')`. Нужно, чтобы kill-switch читался и без активной сессии (холодный старт, окно sign-out/sign-in, протухший access_token) — иначе `useAccountLinksEnabled` кэшировал fail-safe `false` на 5 минут и кнопка «Личный кабинет» пропадала. Остальные ключи `app_config` остаются только для authenticated/админов.
- **БД** (`20260715120000_lava_payment_contracts.sql`): `payment_contracts` (user_id, contract_id unique, tier oracle|master, currency, amount, status pending|active|cancelled|failed, current_period_end, cancelled_at; RLS без политик — только service role).
- **БД** (`20260718150000_payment_offers.sql`): `payment_offers` (tier, locale, offer_id, active; unique tier+locale; RLS без политик). Маппинг (tier, locale) → Lava offerId с fallback на `en`. `tier` ∈ `oracle`|`master`|`webinar`|`book`|`course:<id>`. Цены НЕ хранятся — тянутся из Lava `GET /api/v2/products?feedVisibility=ALL` (кэш 10 мин; `feedVisibility=ALL` обязателен — иначе скрытые «Доступ только по ссылке» продукты не возвращаются). См. `lava_integration.md` §3.
- **БД** (`20260718170000_payment_contracts_one_time.sql`): `payment_contracts` расширена колонками `product_kind` (subscription|one_time) и `product_ref` (для webinar = webinar_id); `tier` — `oracle`|`master`|`webinar`|`book`; `periodicity` — `MONTHLY`|`ONE_TIME`.
- **БД** (`20260718173000_payment_offers_one_time.sql`): seed `webinar/en`, `book/en` (изначально productId — ошибочно).
- **БД** (`20260718230000_fix_webinar_book_offer_ids.sql`): `UPDATE` `webinar/en`, `book/en` → настоящие offerId из `GET /api/v2/products?feedVisibility=ALL` (`offers[].id`); productId ≠ offerId.
- **`MembershipEventsBridge`**: (а) Realtime UPDATE своей строки `users` → `refreshProfile()`; (б) foreground — выборка membership-полей и `refreshProfile()` только при изменении отпечатка; (в) сравнение `baseTierFromRow` с сохранённым `lastTier` → модалка повышения уровня («{from} → {to}», `gate.tierChanged.*`); (г) `trial_expires_at` в прошлом при free-базе → одноразовая модалка `gate.trialEnded.*` (кнопки «Закрыть» / «Личный кабинет»); (д) foreground-проверка последней one_time-покупки через `GET /api/account/purchases/last` при **любом** ctx визита в кабинет (профиль, карточка вебинара, апселл) → если это вебинар или книга, оплаченные после `cabinetVisit.ts`, модалка `gate.webinarPaid.*` / `gate.bookPaid.*` (ретрай 10с на задержку вебхука; флаг `purchaseThanksShown.<uid>.<contractId>`; visit чистится только после показа). Раньше вебинар детектился только при `ctx=webinar:<id>` — оплата из профиля не давала модалки.
- **Страница кабинета** (`web_cabinet/cabinet.html`): редизайн под макет — шапка «ИСКУССТВО ЖИТЬ / Школа Сергея Замкового», заголовок «Личный кабинет», блок «My account» (имя; email со своей строки без дефиса; «Member since»), «Гармонизатор» (тариф, действует до, подписка/статус/следующее списание/отмена), «Другие тарифы» (буллеты ✓, кнопки «Подключить за …»), «Дополнительно» (разовый вебинар «Записаться за …» — только когда есть ближайший вебинар или `ctx=webinar:<id>`; книга «Купить за …» → checkout; месячный интенсив — комбобокс m1..m7 + «Подробнее»). Футер — копирайт `© <год> <имя>` (`new Date().getFullYear()`, `I18N.copyrightName`: ru «Сергей Замковой», прочие «Sergei Zamkovoi»). Логика показа: «Другие тарифы» и блок вебинара скрыты для «Мастера»; демо-доступ приравнен к бесплатному для вебинара. Цены/кнопки — из `overview.*.purchase` (mode checkout→POST/redirect, link→внешний URL). `hzStartUpgrade(tier,purchase,btn)` / `hzStartWebinar(purchase,btn)` / `hzStartBook(purchase,btn)` / `hzCancelSub(btn)` / `hzOpenIntensive()`. По `visibilitychange` — refresh overview. Деплой = копипаст файла в WordPress-блок «HTML-код».

### 3.1 Поток оплаты Lava.top

1. Кабинет: `hzStartUpgrade(tier,purchase)` / `hzStartWebinar(purchase)` / `hzStartBook(purchase)` → `POST /api/account/checkout { kind, tier|webinarId, currency }` → строка `payment_contracts` (pending) → redirect на `paymentUrl` Lava.
2. Вебхуки (`POST /api/account/webhooks/lava`, тело `{ eventType, contractId, parentContractId?, buyer{email}, amount, currency, status, timestamp }`):
   - `payment.success` (subscription) — контракт → active, `current_period_end = +30 дней`; `users.membership_tier = tier`, `membership_expires_at = period_end + 48ч грейс`; все прочие active-контракты пользователя отменяются в Lava и в БД (политика A3).
   - `payment.success` (one_time, tier=webinar) — контракт → active; `membership_*` НЕ трогается; upsert `webinar_registrations(webinar_id=product_ref, user_id)`.
   - `payment.success` (one_time, tier=book) — контракт → active; `membership_*` и регистрации НЕ трогаются; приложение благодарит через `purchases/last`.
   - `payment.failed` — pending → failed;
   - `subscription.recurring.payment.success` — сдвиг периода и `membership_expires_at` (ключ — `parentContractId`);
   - `subscription.recurring.payment.failed` — только лог (Lava ретраит сама);
   - `subscription.cancelled` — контракт → cancelled; `users.membership_*` не трогаем — доступ живёт до `membership_expires_at`, дальше `paidAccess` вернёт free.
   Неизвестный контракт — ответ 200 (ретраи бессмысленны), транзиентная ошибка БД — 5xx (Lava повторит, до 20 попыток).
3. Подхват в приложении — Realtime/foreground `MembershipEventsBridge` (модалка «Уровень профиля обновлён»); для вебинара — `WebinarScreen` повторно проверяет `isRegistered` в foreground + модалка «Вы записаны на вебинар» (`gate.webinarPaid.*`); для книги — `purchases/last` + модалка «Спасибо за покупку книги» (`gate.bookPaid.*`).
4. Даунгрейд = отмена + новая подписка после конца периода (в кабинете после отмены показываются все платные уровни).

## 4. Конфигурация

- Vercel env: `ACCOUNT_CABINET_SECRET` (обязателен), `ACCOUNT_CABINET_ALLOWED_ORIGIN` (default `https://zamkovoi.yoga`), `LAVATOP_API_KEY`, `LAVATOP_WEBHOOK_SECRET`, `LAVATOP_TARIFF_2_ID` (offerId «Наставник»), `LAVATOP_TARIFF_3_ID` (offerId «Мастер»).
- Приложение: `EXPO_PUBLIC_ACCOUNT_CABINET_URL` (default `https://zamkovoi.yoga/cabinet/`).
- Страница: константа `API_BASE` в `cabinet.html` (origin Vercel).
- Kill-switch: `update app_config set value='false' where key='account_links_enabled'` перед отправкой сборки на ревью; `'true'` после прохождения. Без релиза приложения (кэш клиента — до 5 минут). Ключ `account_links_enabled` читается и анонимом (политика `20260719000000`), остальные ключи `app_config` — только для authenticated/админов.

## 5. Комплаенс-политика текстов (инвариант)

Внутри приложения запрещены: цены, «купить/оплатить/тариф/подписка/скидка», ссылки на платёжные страницы, WebView с оплатой. Разрешено: нейтральные «уровень профиля», «расширенные возможности учётной записи», кнопка «Личный кабинет» (системный браузер). Все тексты точек гейтинга — `gate.*` в i18n-каталоге; ревизия новых строк на запрещённые формулировки обязательна. На сайте (внешний веб) ограничений сторов нет.

## 6. Текущее состояние и планируемое

Реализовано: OTT-цепочка, kill-switch, Realtime/foreground-подхват, модалки (смена уровня / конец trial / оплата вебинара / покупка книги), оплата подписок через Lava.top (checkout → paymentUrl → вебхуки → `payment_contracts`/`users.membership_*`), разовая оплата вебинара (ONE_TIME → регистрация `webinar_registrations`), разовая покупка книги (ONE_TIME → `payment_contracts` + модалка благодарности через `purchases/last`), отмена подписки из кабинета, цены по геовалюте, провайдер-абстракция `purchase.mode` (задел под RU-эквайринг). Планируется: читалка книги в приложении (покупка уже фиксируется в БД), курсы/интенсивы через Lava (`tier=course:<id>`; сейчас — внешние ссылки m1..m7), годовая периодичность (Lava PERIOD_YEAR — завести цены в оффере + `periodicity` в checkout), переключатель на российский эквайринг для RUB (`mode:"link"` + url из env).
