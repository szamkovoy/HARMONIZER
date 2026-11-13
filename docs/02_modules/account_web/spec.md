---
id: 02_modules/account_web/spec
title: Account Web (Личный кабинет) Spec
version: 1.31
updated: 2026-11-14
depends_on: [02_modules/subscription/spec, 02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/account/index.ts,
    modules/account/core/openAccountCabinet.ts,
    modules/account/core/presentCabinetBrowser.ts,
    modules/account/core/useModalDismissForBrowser.ts,
    modules/account/core/billingCurrency.ts,
    modules/account/core/cabinetCountry.ts,
    _legacy_web/app/api/geo/ip-country/route.ts,
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
    _legacy_web/app/api/account/paymentGatewayProfile.ts,
    _legacy_web/app/api/account/yookassaRenewals.ts,
    _legacy_web/app/api/cron/yookassa-renewals/route.ts,
    _legacy_web/app/api/account/paymentCatalog.ts,
    docs/04_workspace/payment_gateways.md,
    supabase/migrations/20260731120000_yookassa_renewals_cron.sql,
    _legacy_web/app/api/account/fulfillPaymentContract.ts,
    _legacy_web/app/api/account/overview-data.ts,
    _legacy_web/app/api/account/ott/route.ts,
    _legacy_web/app/api/account/session/route.ts,
    _legacy_web/app/api/account/overview/route.ts,
    _legacy_web/app/api/account/checkout/route.ts,
    _legacy_web/app/api/account/tierCheckout.ts,
    _legacy_web/app/api/account/tierPass.ts,
    _legacy_web/app/api/account/yookassaCheckout.ts,
    _legacy_web/app/api/account/payRetryToken.ts,
    _legacy_web/app/api/account/payPages.ts,
    _legacy_web/app/api/account/payPageCopy.ts,
    _legacy_web/app/api/account/passReminders.ts,
    _legacy_web/app/pay/,
    _legacy_web/app/api/cron/pass-reminders/route.ts,
    supabase/migrations/20261108170536_tier_pass_30d_and_failure_reason.sql,
    _legacy_web/app/api/account/subscription/route.ts,
    _legacy_web/app/api/account/delete/route.ts,
    _legacy_web/app/api/account/wipeUserAccount.ts,
    _legacy_web/app/api/account/cancelActiveSubscriptions.ts,
    _legacy_web/app/api/account/purchases/last/route.ts,
    supabase/migrations/20260728144628_reattach_payment_ledger_by_email.sql,
    _legacy_web/app/api/account/webhooks/lava/route.ts,
    _legacy_web/app/api/account/webhooks/yookassa/route.ts,
    _legacy_web/app/api/account/fx/,
    web_cabinet/cabinet/index.html,
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
3. **Подхват смены уровня** — Realtime на своей строке `users` + тихий foreground-refetch; модалки «Демонстрационный период завершён», «30 дней расширенного доступа истекли» (платный уровень истёк и не продлён: переход с платного на `free` по `lastTier`, один раз; «Закрыть» / «Личный кабинет» — просто открывает кабинет, без выбора тарифа; смена между платными уровнями модалку не вызывает) и «Уровень профиля обновлён» (`MembershipEventsBridge`).
4. **Веб-страницу кабинета** — standalone HTML5 (`web_cabinet/cabinet/` → `https://zamkovoi.yoga/cabinet/`, без WordPress); UI-словари 8 локалей в файле; оферта — `public/cabinet/offer/{lang}.json` на Vercel, только по клику.

## 2. Публичный контракт

Экспорт `modules/account/index.ts`:

- **`openAccountCabinet(ctx?, options?): Promise<void>`** — `POST /api/account/ott` (Bearer JWT) → `presentCabinetBrowser` → SFSafariViewController / Chrome Custom Tabs (`createTask: false` на Android). iOS: `presentationStyle: FullScreen` + светлый `toolbarColor`. `options.beforeOpen` может быть async: скрыть RN Modal и **дождаться native dismiss** (`onDismiss` / safety timeout), плюс короткий settle после fade. Синхронный `onClose`, который размонтирует Modal, недостаточен — презентация SFSafari во время dismiss клинит singleton expo-web-browser (`type: locked`), после чего «Личный кабинет» на Профиле / Home / практиках / вебинаре тоже не открывается. `presentCabinetBrowser` не вызывает `dismissBrowser` до здорового open (иначе можно зависнуть на never-presented VC). `locked` → `dismissBrowser` с таймаутом + повтор; если сессия так и клинит — fallback `Linking.openURL` (Safari.app). Зависший `openBrowserAsync` (present не завершился) не держит JS `opening`: probe ~120 мс → `assumedOpen`, следующий тап снимает `locked`. Android Custom Tabs такого lock не имеют. Бросает при недоступности OTT (`gate.cabinetError`). `ctx`: `"tier"` | `"webinar:<id>"` | `"course:<id>"`. Перед открытием — `cabinetVisit.{userId}`.
- **`useModalDismissForBrowser()`** — хук для gate/notice Modal: `hideAndWait` ставит `visible=false` и резолвится на `onDismiss` (iOS) или через ~500/250 мс safety; не вызывать `onClose` родителя до этого.
- **`prefetchAccountCabinetOtt()`** — фоновый прогрев OTT (TTL кэша ~3 мин из 5 мин серверного); вызывается при фокусе Профиля, открытии gate/upsell.
- **`warmAccountCabinetBrowser()`** — Android `WebBrowser.warmUpAsync` + `mayInitWithUrlAsync` базового URL кабинета (tabs mount).
- **`resolveBillingGeo` / `resolveBillingCurrency`** — страна/валюта кабинета: **сначала** `users.country_code` (только Nominatim после GPS; поле не обнуляется, если позже доступ к гео запретили), иначе **`GET /api/geo/ip-country`** (Vercel `x-vercel-ip-country`, fallback ipwho.is по публичному IP / VPN egress) → RU=RUB, US=USD, иначе EUR. IP **не** пишется в `users.country_code` и **не** персистится в SecureStore (VPN не должен засорять GPS-поле). В ссылку уходят `currency` + `country` (шлюз). Timeout **800 мс** даёт эфемерный EUR **без** записи в SecureStore; GPS-страна из профиля персистится.
- **`getAccountCabinetUrl()`** — URL кабинета; переопределяется `EXPO_PUBLIC_ACCOUNT_CABINET_URL`.
- **`useAccountLinksEnabled(): boolean`** / **`getAccountLinksEnabled()`** — kill-switch из `app_config` (in-memory TTL 5 мин + персист последнего явного значения; fail-safe `false`). «Нет строк»/сеть/503 schema cache НЕ пишутся как свежее `false`; при ошибке — ретраи, затем прежний кэш/персист. Персист убирает мигание кнопки на Профиле, пока идёт refetch.
- **`MembershipEventsBridge`** — компонент без UI-поверхности (кроме модалок), монтируется один раз в `app/_layout.tsx` под `AuthProvider`.

Внутреннее (не экспортируется из barrel): `core/accountFlagsStore.ts` — персистентные флаги (`lastTier.{userId}`, `trialEndedShown.{userId}`) в SecureStore/localStorage.

### API `_legacy_web/app/api/account/*`

| Роут | Auth | Назначение |
| --- | --- | --- |
| `POST /api/account/ott` | Bearer JWT Supabase (приложение) | Выдаёт OTT: 32 байта base64url, в БД только sha256-хэш, TTL 5 мин |
| `POST /api/account/session` | без auth, body `{ ott }`, CORS = origin сайта | Атомарно гасит OTT (`UPDATE … WHERE used_at IS NULL`), возвращает `{ sessionToken, overview }` |
| `GET /api/account/overview` | Bearer кабинетной сессии, query `?currency=&country=` | Свежий `overview`; `paymentGateway` (available/provider); цены по выбранному шлюзу. Нет шлюза → prices null + `payment_gateway_unavailable` |
| `POST /api/account/checkout` | Bearer кабинетной сессии, body `{ kind, tier?, webinarId?, currency, country? }` | `resolvePaymentGateway({ country, currency })`. Нет шлюза → `503 payment_gateway_unavailable`. Lava / ЮKassa как раньше; ЮKassa всегда RUB. `kind`: `subscription` \| `pass` (30 дней без автопродления, §3.5) \| `webinar` \| `book`. Тариф идёт через `startTierCheckout`; вебинар и книга — через `startOneTimeCheckout`. Отказ тарифа — `409 { error, code }`, `code` ∈ `already_active` \| `has_subscription` \| `higher_access`. |
| `GET /pay/failed?t=` | подписанный токен (HMAC `ACCOUNT_CABINET_SECRET`, 24 ч). `v=c` — отмена на форме Lava. `c=` — id счёта из письма | Страница после неудачной оплаты (8 локалей). Тариф: другая карта / PayPal / 30 дней (§3.5). Разовая покупка (`k="o"`, вебинар или книга): оплатить ещё раз / иностранная карта / PayPal. Текст — по `failure_reason` счёта из `c=`, если он принадлежит владельцу токена; без `c` — по последнему отказу. `v=c` — «Оплата не завершена» (§3.5) |
| `GET /pay/renew?t=` | токен из письма (10 дней) | «Продлить доступ»: ещё 30 дней / PayPal / подписка |
| `POST /pay/retry` | form `t`, `o` ∈ `card`\|`foreign`\|`paypal`\|`pass`\|`subscription` | Новый счёт без ввода email/имени → `303` на форму Lava/ЮKassa. Для разовой покупки (`k="o"`) кнопки `card` / `foreign` / `paypal` открывают тот же вебинар или книгу |
| `GET /pay/return?t=&c=` | токен тарифа или разовой покупки + id контракта | Возврат из ЮKassa: успех → кабинет `?paid=1`, отказ банка → страница отказа, pending → «Проверяем оплату…» (2×3 с), потом «Оплата не завершена» |
| `GET /pay/widget-return?c=&w=&p=&s=` | подпись HMAC `ACCOUNT_CABINET_SECRET`, без сессии | Возврат виджета из ЮKassa (§3.4). Успех → `successUrl` или `?hz_paid=`, иначе кабинет `?paid=1`. Отказ и pending после двух проверок → `?hz_unpaid=`. Битая подпись → кабинет без `?paid=1` |
| `POST /api/cron/pass-reminders` | `x-cron-secret` | Письмо за 12 часов до конца оплаченных 30 дней (§3.5) |
| `GET /api/account/purchases/last` | Bearer JWT Supabase (приложение) | Последняя активная one_time-покупка, кроме 30 дней тарифа (`{ kind, productRef, createdAt, contractId }` | null). Приложение благодарит за книгу/вебинар (`gate.bookPaid.*` / `gate.webinarPaid.*`) на cold start и foreground. Таблица `payment_contracts` закрыта для клиента — чтение только service role |
| `GET /api/account/purchases/book` | Bearer JWT Supabase (приложение) | Ownership книги для ридера: `{ owned, contractId?, purchasedAt? }` (active one_time `tier=book`). Shared helper `bookOwnership.ts` с overview |
| `GET /api/account/subscription` | Bearer кабинетной сессии | Последний контракт со статусом active/cancelled |
| `DELETE /api/account/subscription` | Bearer кабинетной сессии | Отмена через `cancelActiveSubscriptionsForUser` (`lavatop` → Lava DELETE; `yookassa` → methods `inactive` + сброс `payment_method_id`) + статус cancelled; доступ до `current_period_end` / `membership_expires_at`. |
| `DELETE /api/account/delete` | Bearer JWT Supabase (приложение) | Удаление аккаунта через `wipeUserAccount`: (1) email из user JWT (`requireUser`); (2) если `users.store_review_account` — **403** (демо модерации сторов); (3) `cancelActiveSubscriptionsForUser` → `cancelProviderSubscription` (Lava API; ЮKassa — DB-only до рекуррента; unknown provider → fail-closed); (4) `cancelActiveEmailAutomationsForUser` — активные email-цепочки → `cancelled` (повторная регистрация может стартовать welcome заново); (5) снимок `buyer_email`; (6) `auth.admin.deleteUser` — леджер остаётся (`ON DELETE SET NULL`); `email_contacts` уходит CASCADE вместе с `users`. Ответ `{ deleted: true }`. Тот же wipe — `DELETE /api/admin/users/[id]` (админский wipe store-review не блокирует). |
| `POST /api/account/webhooks/lava` | заголовок `X-Api-Key` = `LAVATOP_WEBHOOK_SECRET` | Приём событий Lava (см. §3.1) |
| `POST /api/account/webhooks/yookassa` | опц. `YOOKASSA_WEBHOOK_SECRET` + всегда GET payment у API | События ЮKassa (см. §3.3) |
| `GET /api/widget/:id?lang=&tz=` | без auth, CORS `*` | Конфиг виджета лендинга: тексты на показанном языке, элементы, стиль, `prices.{ru,int}`, `methods`, `defaultMethod` (см. §3.4) |
| `POST /api/widget/:id/checkout` | без auth, CORS `*`, honeypot `website`, ≤5 попыток на email за 10 мин | Body `{ name, email, method: ru\|int, lang, pageUrl }` → pending-контракт `source=widget` → `{ paymentUrl }`; ошибки — машинные коды `invalid_email`, `invalid_name`, `email_rejected`, `already_active`, `unavailable`, `too_many`, `checkout_failed` |

Кабинетная сессия — компактный HMAC-SHA256 токен (`payload.sig`, TTL 60 мин, секрет `ACCOUNT_CABINET_SECRET`); прав хватает на чтение overview и операции с собственной подпиской. `AccountOverview`: как раньше; цены из активного шлюза. `book.owned` — есть ли active one_time-контракт `tier=book`. `purchase.mode` — `"checkout"` (POST + redirect) для Lava и ЮKassa; `"link"` — задел под внешний URL без нашего чекаута.

## 3. Внутренняя архитектура

- **БД** (`20260714220000_web_account_ott.sql`): `web_ott_tokens` (RLS без политик — только service role), `app_config` (RLS: select для authenticated, insert/update для админов; seed `account_links_enabled=true`), `users` добавлена в publication `supabase_realtime`.
- **БД** (`20260719000000_app_config_anon_read_account_links.sql`): доп. политика select на `app_config` для `anon, authenticated` с ограничением `using (key = 'account_links_enabled')`. Нужно, чтобы kill-switch читался и без активной сессии (холодный старт, окно sign-out/sign-in, протухший access_token) — иначе `useAccountLinksEnabled` кэшировал fail-safe `false` на 5 минут и кнопка «Личный кабинет» пропадала. Остальные ключи `app_config` остаются только для authenticated/админов.
- **БД** (`20260715120000_lava_payment_contracts.sql`): `payment_contracts` (user_id, contract_id unique, tier oracle|master, currency, amount, status pending|active|cancelled|failed, current_period_end, cancelled_at; RLS без политик — только service role).
- **БД** (`20261113093000_payment_events.sql`): `payment_events` — журнал вебхука, сверки и отказа checkout (сырой JSON и наш ответ). `payment_alert_sends` — одна отправка письма админу на пару `contract_id` + `event_type`. Для `yookassa.renewal.failed` в `event_type` ключа дописывается дата Europe/Moscow (`YYYY-MM-DD`). RLS включён, политик нет, `public` / `anon` / `authenticated` отозваны. Клиенты к таблицам не ходят.
- **БД** (`20260720092052_payment_ledger_survive_user_delete.sql`): `payment_contracts.user_id` и `payments.user_id` — nullable, FK `ON DELETE SET NULL`; колонка `buyer_email` (снимок email при checkout / перед deleteUser). Платёжные строки переживают удаление аккаунта для отчётов.
- **БД** (`20260728144628_reattach_payment_ledger_by_email.sql`, правило живости — `20261113090000_lapse_stale_subscriptions.sql`): при signup `handle_new_auth_user` вызывает `reattach_payment_ledger_for_email` — orphan-строки с тем же `buyer_email` снова получают `user_id`. Подписка действует, только если `status = active` и (`current_period_end` пуст или `current_period_end + 48ч > now()`). `restore_membership_from_ledger` поднимает `membership_*` из грантов, таких живых подписок, отменённых с ещё не истёкшим `current_period_end` и оплаченных 30 дней (`one_time`, `product_ref = pass_30d`, `active`, период в будущем, без +48ч). `lapse_stale_subscriptions()` переводит active-подписку с `current_period_end` старше 72ч в `cancelled` (`failure_reason` = `lapsed: no renewal`, если причины ещё не было) и гасит активные методы ЮKassa этого пользователя. Hourly `reconcile_expired_memberships` вызывает зачистку до пересчёта. Orphan-подписки у шлюза **не** отменяются backfill’ом.
- **БД** (`20260718150000_payment_offers.sql`): `payment_offers` (tier, locale, offer_id, active; unique tier+locale; RLS без политик). Маппинг (tier, locale) → Lava offerId с fallback на `en`. `tier` ∈ `oracle`|`master`|`webinar`|`book`|`course:<id>`. Цены НЕ хранятся — тянутся из Lava `GET /api/v2/products?feedVisibility=ALL` (кэш 10 мин; `feedVisibility=ALL` обязателен — иначе скрытые «Доступ только по ссылке» продукты не возвращаются). См. `lava_integration.md` §3.
- **БД** (`20260718170000_payment_contracts_one_time.sql`): `payment_contracts` расширена колонками `product_kind` (subscription|one_time) и `product_ref` (для webinar = webinar_id); `tier` — `oracle`|`master`|`webinar`|`book`; `periodicity` — `MONTHLY`|`ONE_TIME`.
- **БД** (`20260718173000_payment_offers_one_time.sql`): seed `webinar/en`, `book/en` (изначально productId — ошибочно).
- **БД** (`20260718230000_fix_webinar_book_offer_ids.sql`): `UPDATE` `webinar/en`, `book/en` → настоящие offerId из `GET /api/v2/products?feedVisibility=ALL` (`offers[].id`); productId ≠ offerId.
- **БД** (`20260722120000_yookassa_payment_catalog.sql`): `payment_catalog` (SKU ЮKassa/RUB: oracle 950, master 4950, webinar 950, book 1500); на `payment_contracts` — `provider_payment_id`, `payment_method_id`; таблица `yookassa_payment_methods` (задел рекуррента). RLS без политик — service role.
- **`MembershipEventsBridge`**: (а) Realtime UPDATE своей строки `users` → `refreshProfile()` — канал открыт **только в окне `REALTIME_WINDOW_MS` = 30 мин после `markCabinetVisit`** (событие `subscribeCabinetVisit` из `openAccountCabinet.ts`; при холодном старте — если визит ещё свежий) и игнорирует эхо собственных PATCH, у которых `membership_tier/membership_expires_at/trial_expires_at` в `payload.new` совпадают с текущим профилем; вне окна подхват — только foreground-refetch (б); (б) foreground — выборка membership-полей и `refreshProfile()` только при изменении отпечатка; (в) сравнение `baseTierFromRow` с сохранённым `lastTier` → модалка повышения уровня («{from} → {to}», `gate.tierChanged.*`); (г) `trial_expires_at` в прошлом при free-базе → одноразовая модалка `gate.trialEnded.*` (кнопки «Закрыть» / «Личный кабинет»); (д) cold start + foreground: `GET /api/account/purchases/last` → модалка `gate.webinarPaid.*` / `gate.bookPaid.*` один раз на `contractId` (`purchaseThanksShown.<uid>.<contractId>`), если покупка после `cabinetVisit` **или** не старше 7 дней (админ-грант без кабинета); ретрай 10с при свежем визите в кабинет без покупки.
- **Страница кабинета** (`web_cabinet/cabinet/index.html`): standalone HTML5. Перед redirect на оплату кладёт кабинетную сессию в `sessionStorage` (чтобы вернуться с `?paid=1` без OTT). При `?paid=1` — блок «Спасибо за оплату» (8 локалей). Блок «Гармонизатор»: период тарифа = `current_period_end − 30d` … `current_period_end` (без +48h grace из `membershipExpiresAt`); при active — «Следующее списание» = `currentPeriodEnd`. Блок книги: accordion (chevron `icons/day_action_chevron.png` + название) → Vimeo по локали + `bookBlurb` между заголовком и «Купить»; свёртка снимает `iframe.src`. Если `overview.book.owned` (active one_time `tier=book`) — блок продажи книги не рендерится. **Аналитика:** Яндекс.Метрика `39862855` (webvisor/clickmap/trackLinks) — после early-boot `POST /session`, `tag.js` async + `requestIdleCallback` (timeout 2.5 с), чтобы не конкурировать с session/overview. **Деплой:** ISPManager папка `cabinet/` → `https://zamkovoi.yoga/cabinet/`; Vercel — API + `offer/*.json`.

### 3.1 Поток оплаты Lava.top

1. Кабинет: `hzStartUpgrade(tier,purchase)` / `hzStartWebinar(purchase)` / `hzStartBook(purchase)` → `POST /api/account/checkout { kind, tier|webinarId, currency }` → строка `payment_contracts` (pending) → redirect на `paymentUrl` Lava.
2. Вебхуки (`POST /api/account/webhooks/lava`, тело `{ eventType, contractId, parentContractId?, buyer{email}, amount, currency, status, timestamp }`):
   - `payment.success` — первая оплата Lava (подписка, 30 дней, разовая покупка, виджет) идёт только через `fulfillFirstPaymentSuccess`, общий с ЮKassa. Подписка: контракт → active, `current_period_end = +30 дней`; `users.membership_tier = tier`, `membership_expires_at = period_end + 48ч грейс`; прочие active-подписки пользователя отменяются (политика A3); затем settlement (см. §3.2). Если контракт уже `active`, а `users` короче оплаченного периода, тот же вызов довыдаёт доступ (`ensureMembershipForActiveContract`) и не затирает более высокий тариф.
   - `payment.success` (one_time, tier=webinar) — контракт → active; `membership_*` НЕ трогается; upsert `webinar_registrations(webinar_id=product_ref, user_id)`; settlement.
   - `payment.success` (one_time, tier=book) — контракт → active; `membership_*` и регистрации НЕ трогаются; приложение благодарит через `purchases/last`; settlement.
   - `payment.failed` — pending → failed, `errorMessage` Lava → `failure_reason` (напр. `Declined by 3-D Secure`);
   - `subscription.recurring.payment.success` — сдвиг периода и `membership_expires_at` (ключ — `parentContractId`) + settlement на сумму вебхука;
   - `subscription.recurring.payment.failed` — терминальное (Lava шлёт его только после последней попытки, `subscription.cancelled` следом не приходит). Контракт `active` → `cancelled`, `failure_reason` = `renewal: …` (текст `errorMessage` или `status`). `users.membership_*` не трогаем. После ответа — `cancelLavaSubscription` и письмо покупателю: продление не прошло, доступ до `current_period_end`, кнопка на `/pay/renew?t=` (язык `users.locale`, 8 локалей). Отказ, при котором конец периода ещё дальше чем через 5 суток, игнорируется.
   - `subscription.cancelled` — контракт → cancelled; `users.membership_*` не трогаем — доступ живёт до `membership_expires_at`, дальше `paidAccess` вернёт free.
   Подписка действует = `status = active` и (`current_period_end` пуст или `current_period_end + 48ч > now()`). Такое же правило у checkout: просроченная active-подписка не даёт `409 already_active` / `has_subscription`. Кабинет не показывает строку, у которой период (для active — с 48ч грейсом) уже прошёл.
   Неизвестный контракт — ответ 200 (ретраи бессмысленны), транзиентная ошибка БД — 5xx (Lava повторит, до 20 попыток). Сбой FX/settlement логируется, но **не** валит активацию (ответ всё равно 2xx).
   Вебхук отвечает, как только оплата записана в базу (пропуск или тариф). Письмо, курсы и отмена старой подписки доделываются уже после ответа: Lava считает доставку неудачной, если ответа нет за 10 секунд. Запрос к базе на этом пути обрывается через 4 секунды, чтобы зависший вызов не съел весь лимит.
   Если вебхук так и не дошёл, счёт остаётся `pending`. Планировщик раз в 10 минут смотрит, есть ли pending-счёт Lava возрастом от 10 до 22 минут. Таких нет — наружу никто не ходит. Такой есть — `GET /api/v1/invoices/{id}` только по нему (получается одна или две проверки, дальше окно закрывается). `COMPLETED` проводится тем же `fulfillFirstPaymentSuccess` (дата оплаты — `datetime` инвойса), `FAILED` → `failed` и `failure_reason` = `reconcile: invoice FAILED`, незавершённый счёт остаётся `pending`.
   Каждое принятое событие Lava и ЮKassa пишется в `payment_events` уже после ответа (`after`): сырой JSON, наш ответ, HTTP-статус. Туда же пишут сверка Lava, cron продлений ЮKassa и отказ или ошибка создания счёта в checkout и `/pay/retry`. Сбой записи в журнал не меняет ответ вебхуку.
   Письмо на `PAYMENT_ALERT_EMAIL` уходит после ответа на `payment.failed`, `subscription.recurring.payment.failed`, отмену ЮKassa и отказ её продления, ошибку создания счёта и `FAILED` сверки Lava. В письме: время Europe/Moscow, email, ссылка на `/admin/users/<id>`, продукт, сумма и валюта, шлюз, contractId, `failure_reason`, сырой JSON. Повтор того же `contract_id` и `event_type` не отправляется. Отказ продления ЮKassa (`yookassa.renewal.failed`) дедуплицируется по московской дате: в другой день письмо по тому же контракту уходит снова. Нет `PAYMENT_ALERT_EMAIL` — строка в лог, оплата не падает. Зачистка `lapse_stale_subscriptions` письмо не шлёт.
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

### 3.3 ЮKassa + профили шлюзов

Маршрутизация — `resolvePaymentGateway` ([`paymentGatewayProfile.ts`](_legacy_web/app/api/account/paymentGatewayProfile.ts)); ops — [`docs/04_workspace/payment_gateways.md`](docs/04_workspace/payment_gateways.md).

```
enabled gateway REGION === country  →  that gateway
else enabled REGION=INT             →  INT gateway
else                                →  fail-closed
```

1. Overview/checkout принимают `country` (+ `currency`). ЮKassa → цены `payment_catalog` / checkout RUB.
2. Первый платёж: `POST /v3/payments` redirect; подписки всегда с `save_payment_method` (если магазин ещё не разрешил recurring → retry без save, доступ +30d всё равно). Webhook пишет `yookassa_payment_methods`, когда method реально сохранён.
3. Renewal: cron `yookassa-renewals` (всегда on) → `chargeYookassaSavedMethod` (`payment_method_id`, metadata.kind=`renewal`) → webhook/cron → `fulfillYookassaRenewal` (+30d + grace + settlement). Fail: `renew_fail_count`; 2 fails или `permission_revoked` → cancel + method inactive. Без `payment_method_id` renew нечего делать. Webhook всегда обновляет `provider_payment_id` на id текущего платежа (для админского refund).
4. Cancel/wipe: methods → `inactive` (ЮKassa не удаляет method API-side).
5. Админский возврат: `refundPaymentContract` (`yookassa_api` = GET payment + POST refund; mark-режимы без API). Успех → `refunded` + settlement `refunded_at` + лучший оставшийся тариф (контракты+гранты). Платежи другого shopId — только mark после возврата в ЛК того магазина.
6. Чеки 54-ФЗ не передаём.

**Runbook:** env (`PAYMENT_*_ENABLED/REGION` + `YOOKASSA_SHOP_ID/SECRET/RETURN_URL`) → webhook URL на актуальном shop → `cabinet/` с `country` → smoke RU/INT. Ops: [`docs/04_workspace/payment_gateways.md`](docs/04_workspace/payment_gateways.md).

### 3.4 Виджеты оплаты для лендингов

Миграция `20261007190000_payment_widgets_webinar_passes.sql`.

- **Единый каталог** `payment_catalog`: SKU ЮKassa (RUB) + `lava_offer_id` (оффер Lava, не продукт; цены Lava только читаются из API), `letter_subject_i18n` / `letter_body_i18n` (письмо покупателю с виджета, 8 локалей, plain text, `{{name}}`), `webinar_credits` / `webinar_window_days`, `sort_order`. Tier **`webinar_pack`**, **`spb_practicum`**, **`surcharge`**, **`yoga_course`**, **`diagnostics`**, **`consultation`** и **`healing_session`** (CHECK на `payment_catalog` и `payment_contracts`). `spb_practicum` — «Практикум в Санкт-Петербурге», 2500 ₽; `surcharge` — «Доплата», 13000 ₽. Оба только ЮKassa (`lava_offer_id` пустой). `yoga_course` — «Месячный курс йоги с 20% скидкой», 24000 ₽ и оффер Lava `7c9bd26c-70a2-4d98-82b3-a29bbf07b498` (240 € / 269,26 $). `diagnostics` — «Диагностика», 3000 ₽, оффер Lava `282eb496-d561-49e2-8efc-5a14ad8a42f2` (30 € / 30 $). `consultation` — «Консультация», 10000 ₽, оффер `59afc5fe-c9b1-45e6-aea9-fe4a91cf7e6d` (100 € / 100 $). `healing_session` — «Целительная сессия», 30000 ₽, оффер `5284f95f-0aa9-4220-bd46-e7e141527948` (300 € / 300 $). У каждого свой виджет лендинга и письмо покупателю на 8 языках (`{{name}}`). Эти продукты в обзор кабинета приложения не входят (там только Наставник, Мастер, ближайший вебинар и книга). Покупка не меняет тариф и не даёт пропуск на вебинары. `resolveLavaOfferIdByName`: `payment_offers` (локаль) → `payment_catalog.lava_offer_id` → `payment_offers` `en`.
- **`payment_widgets`** (`title`, `catalog_id`, `config` jsonb, `active`; RLS без политик). Конфиг — `_legacy_web/lib/paymentWidget/config.ts` (`normalizeWidgetConfig`): `paymentMode` `choice|ru|int`, `successUrl`, `requireName`, порядок/видимость 8 элементов (email и кнопка всегда видимы), стиль, `texts[locale]` поверх дефолтов `lib/paymentWidget/copy.ts` (8 локалей + системные ошибки, включая `errUnpaid`; отдельного списка ключей нет — `resolveWidgetTexts` кладёт весь `getWidgetSystemTexts` в `texts` ответа `GET /api/widget/:id`).
- **Скрипт** `_legacy_web/public/widget.js` (код вставки: `<script src="https://harmonizer.zamkovoi.yoga/widget.js" data-id="…" data-lang="ru|…|auto" async>`): Shadow DOM, каждый `<script>` — независимый экземпляр (несколько виджетов и копии на одной странице). Язык: `data-lang` или язык браузера; `resolveWidgetLocale` берёт его, только если там заполнены все тексты, написанные автором на основном языке (иначе весь виджет на `ru`). Метод по умолчанию: страна по IP RU → `ru`, иначе `int`; страна неизвестна → часовой пояс браузера из списка зон РФ. Валюта Lava: US → USD, иначе EUR (fallback на другую, если цены нет). Успешный возврат открывает `?hz_paid=<widgetId>`: этот заход показывает благодарность и сразу убирает параметр из адреса (`history.replaceState`). Неоплаченный возврат открывает `?hz_unpaid=<widgetId>`: форма с надписью `errUnpaid`, параметр снимается так же. Обновление и любой следующий заход снова показывают форму без этой надписи, чтобы на том же лендинге можно было оплатить следующий вебинар. `window.HarmonizerWidget.render` — для предпросмотра в админке.
- **Checkout** создаёт контракт `source=widget` с `buyer_email/name/locale`, `widget_id`, `catalog_id`; `user_id` — только если email уже известен (`email_contacts`). Для существующего пользователя подписка не ниже/не равна активной (`already_active`). ЮKassa: один `return_url` = `GET /pay/widget-return?c=<contractId>&w=<widgetId>&p=<pageUrl>&s=<HMAC>`. Подпись считается по `c`, `w` и очищенному `p` (`returnPageUrl`: только http(s), без hash; query длиннее 1000 символов срезается до пути). Успех (`active` или платёж ЮKassa `succeeded` / `waiting_for_capture`) ведёт на `successUrl`, иначе на `?hz_paid=<id>`, иначе в кабинет `?paid=1`. Отказ и всё ещё `pending` после двух проверок — на `?hz_unpaid=<id>`, иначе в кабинет без `?paid=1`. Битая подпись — в кабинет без `?paid=1`. Lava: `successful_return_url` = `successUrl` или `?hz_paid=<id>`; `failure_return_url` и `cancel_return_url` = `?hz_unpaid=<id>`.
- **Fulfill** (`fulfillFirstPaymentSuccess`, ЮKassa и Lava — Lava для one_time и всех `source=widget` делегирует сюда): `ensureWidgetBuyer` (`widgetFulfillment.ts`) — существующий аккаунт по email или новый подтверждённый (`email_confirm`, `full_name`, `locale`), `trial_expires_at = null` (демо стартует при первом входе); контакт рассылки (`source=widget`). Если контакт был `unsubscribed`, покупка (любая, включая продление) возвращает его в `active`. `complained` и `suppressed` не меняются. Письма о покупке и о вебинаре уходят независимо от статуса контакта.
- Tier `webinar` без `product_ref` и `webinar_pack` → `webinar_passes` (кредиты/окно из каталога, окно `[paid_at − 60 минут, paid_at + days)`) + `apply_webinar_passes(user)` один раз, не по крону. Час до оплаты — тот же допуск, что у входа на вебинар: оплата в первые 60 минут после начала относится к этому вебинару, и уходит приглашение со ссылкой на комнату, как если бы оплатили до старта. Если в окне уже есть опубликованный вебинар — уходит приглашение (`webinarNotices.ts`), а письмо из каталога не отправляется. Если вебинара ещё нет — отправляется письмо из каталога (`letter_*_i18n`). В нём нет даты и ссылки на комнату: ссылка придёт отдельным письмом, когда комната будет готова, после вебинара придёт ссылка на запись, и та же ссылка появится на баннере в приложении. Покупка тарифа «Мастер» шлёт приглашения на уже опубликованные вебинары и не отменяет письмо каталога. Язык письма — `users.locale`, иначе язык контакта, иначе `buyer_locale`. Если на этом языке нет своего текста, всё письмо (тема и текст) уходит по-русски. Пустая строка в тексте каталога — пустая строка в письме. Футера «вы получили это письмо… отписаться» и заголовка List-Unsubscribe нет: это письмо о покупке, как код входа. Идемпотентность письма каталога — `buyer_letter_sent_at`; приглашений — `webinar_notice_sends`. Сбой письма не валит вебхук.
- **Возврат** one_time: `webinar_passes.status = revoked`, регистрации пропуска на ещё не начавшиеся вебинары удаляются.
- **Гео за прокси** (`ipCountry.ts`): `X-Harmonizer-Client-Ip` от REG.RU-прокси → ipwho.is; запрос с адреса прокси без этого заголовка → страна неизвестна (не `x-vercel-ip-country`=RU прокси).

### 3.5 Неудачная оплата тарифа и 30 дней без автопродления

Миграция `20261108170536_tier_pass_30d_and_failure_reason.sql`. Повод: Lava отклоняет оформление подписки, когда банк не проходит полный 3‑D Secure (сохранение карты), хотя разовые платежи той же карты проходят.

- **Счёт тарифа** (`startTierCheckout`, кабинет и `/pay/retry`): Lava получает `successful_return_url` = кабинет `?paid=1`, `failure_return_url` = `/pay/failed?t=<токен>`, `cancel_return_url` = `/pay/failed?t=<токен>&v=c`; для PayPal — `paymentMethod: PAYPAL` (только EUR/USD). ЮKassa: `return_url` = `/pay/return?t=&c=<contractId>` (у неё один адрес на успех и отказ, статус берём из API). При отказе банка ЮKassa оставляет человека на своей форме («Не сработало…») и даёт повторить в том же платеже; к нам он попадает по «Выйти из оплаты» или по истечении таймера, платёж ещё `pending` — после двух проверок показываем «Оплата не завершена».
- **Счёт вебинара и книги** (`startOneTimeCheckout`): ЮKassa возвращает на `/pay/return?t=&c=`. Lava: `successful_return_url` = кабинет `?paid=1`, `failure_return_url` = `/pay/failed?t=`, `cancel_return_url` = `/pay/failed?t=&v=c`. Токен разовой покупки — `k="o"` (`t` = webinar|book, `r` = id вебинара). `v=c` показывает «Оплата не завершена».
- **Токен** (`payRetryToken.ts`): для тарифа — userId, tier, вид (подписка / 30 дней), валюта, страна, язык. Для вебинара и книги — userId, продукт, id вебинара, валюта, страна, язык. Хватает на новый счёт на email владельца аккаунта, больше ничего не даёт.
- **Страница после отказа**: три текста — «Оплата не завершена» (человек ушёл с формы), «Оплата не удалась» с пояснением про 3‑D Secure, и тот же заголовок без этого пояснения для прочего отказа. Кнопки тарифа: тот же вид оплаты другой картой (на «не завершена» подпись «Оплатить ещё раз»); после ЮKassa (если Lava включена) — «Оплатить картой иностранного банка» (Lava, EUR без страны → профиль INT): ЮKassa не принимает зарубежные карты; PayPal — только если шлюз Lava и валюта не RUB; «30 дней без автопродления» — после отказа подписки, если 30 дней можно продать. Вебинар и книга: «Оплатить ещё раз», иностранная карта и PayPal, без 30 дней. Если оплата уже прошла — сразу в кабинет `?paid=1`.
- **30 дней тарифа** — `payment_contracts`: `product_kind=one_time`, `tier` oracle|master, `periodicity=ONE_TIME`, `product_ref=pass_30d`. Lava — отдельные разовые продукты (`payment_offers` `oracle_30d` / `master_30d`, `en`), ЮKassa — цена тарифа из `payment_catalog`, без `save_payment_method` и не только карта. Активация (`activateTierPass`): `current_period_end` = конец текущего доступа того же тарифа (если ещё действует) или дата оплаты, + 30 дней, без 48 ч запаса; `users.membership_*` ставятся, если нет более высокого оплаченного тарифа; подписки не отменяются; «Мастер» шлёт приглашения на вебинары и входит в рассылку записи.
- **Ограничения продажи**: 30 дней не продаём при активной подписке (её продление переписало бы `membership_*`) и при действующем более высоком тарифе; подписку не продаём ниже действующего оплаченного тарифа. Подписка того же тарифа поверх оплаченных 30 дней не укорачивает доступ.
- **Причина отказа**: `payment_contracts.failure_reason` — Lava `errorMessage`, ЮKassa `party:reason` из `cancellation_details`.
- **Напоминание**: раз в час (cron `send_pass_reminders_hourly`, :45; Postgres сначала проверяет, есть ли кому писать) — одно письмо за ≤12 часов до `current_period_end` (`pass_reminder_sent_at`): за три дня человек откладывает оплату. Миграция `20261108180153`. Ранняя оплата 30 дней того же тарифа считается от конца текущих, поэтому новое письмо придёт перед новым концом; старый контракт помечается без письма. Не уходит, если человек уже продлил (подписка или следующие 30 дней). Кнопка ведёт на `/pay/renew`. Язык — `users.locale`, даты — Luxon.
- **Отказ первой оплаты из кабинета**: cron `reconcile_lava_payments_every_10m` после сверки вызывает `runPaymentFailedNotices`. Postgres зовёт Vercel, только если есть pending-счёт Lava 10–22 минут или кандидат на это письмо. Кандидат: `failed`, `user_id` есть, `source` не `widget`, `failed_notice_sent_at` пуст, `updated_at` от 30 минут до 24 часов назад, `failure_reason` не `Cancelled by customer…` и не `…expired_on_confirmation`. Продукт — oracle|master подписка или `product_ref=pass_30d`, либо вебинар|книга с `product_kind=one_time`. На пользователя уходит письмо только по самому свежему отказу; остальные кандидаты помечаются без письма. Письмо не уходит (но контракт помечается), если после отказа уже есть оплата того же продукта (для тарифа — active-подписка или 30 дней того же круга «доступ», либо `paidTierFromRow` не пуст; для вебинара и книги — такая же активная покупка, а для вебинара ещё и если он уже прошёл) или если такое письмо уже уходило за 24 часа. У вебинара и книги свои тема и текст; кнопка общая — `/pay/failed?t=&c=<contractId>`, токен на 10 дней, язык `users.locale`. Событие `notice.payment_failed` в `payment_events`. Миграции `20261113140000` и `20261113212156` накачены. Кандидат вебинара и книги — `20261114021000`.
- **Брошенная форма**: ЮKassa `expired_on_confirmation` и Lava `Cancelled by customer` — письмо покупателю не шлём. Письмо админу тоже не шлём: ЮKassa `payment.canceled` и Lava `payment.failed`. Журнал `payment_events` пишется.
- **Возврат** 30 дней пересчитывает тариф как возврат подписки (`revokeOrRestoreMembershipAfterRefund` учитывает и такие контракты). `purchases/last` их не отдаёт, чтобы не перекрыть благодарность за вебинар или книгу.

## 4. Конфигурация

- Vercel env (Lava): `ACCOUNT_CABINET_SECRET`, `ACCOUNT_CABINET_ALLOWED_ORIGIN` (default `https://zamkovoi.yoga`), `LAVATOP_API_KEY`, `LAVATOP_WEBHOOK_SECRET`, `LAVATOP_TARIFF_2_ID`, `LAVATOP_TARIFF_3_ID`. Опционально: `LAVA_GATEWAY_FEE_RATE`, `YANDEX_GATEWAY_FEE_RATE`.
- `PAYMENT_ALERT_EMAIL` — куда писать о сбое оплаты. Нет переменной — письмо пропускается, вебхук отвечает как раньше.
- Vercel env (шлюзы): `PAYMENT_LAVATOP_ENABLED`, `PAYMENT_LAVATOP_REGION=INT`, `PAYMENT_YOOKASSA_ENABLED`, `PAYMENT_YOOKASSA_REGION=RU`, `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_RETURN_URL`, опц. `YOOKASSA_WEBHOOK_SECRET`. Удалены: `YOOKASSA_ENABLED`, `PAYMENT_GATEWAY_FOR_RUB`, `YOOKASSA_RECURRING_ENABLED`.
- Приложение: `EXPO_PUBLIC_ACCOUNT_CABINET_URL` (default `https://zamkovoi.yoga/cabinet/`); OTT URL передаёт `currency` + `country`.
- Страница: константа `API_BASE` в `web_cabinet/cabinet/index.html` — `https://harmonizer.zamkovoi.yoga` (не `*.vercel.app`: домен блокируется в РФ). На хостинге это `/www/zamkovoi.yoga/cabinet/index.html`. Оферта — `{API_BASE}/cabinet/offer/{lang}.json`. CORS по-прежнему смотрит на origin страницы (`ACCOUNT_CABINET_ALLOWED_ORIGIN`, `https://zamkovoi.yoga`), не на API host.
- Kill-switch: `update app_config set value='false' where key='account_links_enabled'` перед отправкой сборки на ревью; `'true'` после прохождения. Без релиза приложения (кэш клиента — до 5 минут). Ключ `account_links_enabled` читается и анонимом (политика `20260719000000`), остальные ключи `app_config` — только для authenticated/админов.

## 5. Комплаенс-политика текстов (инвариант)

Внутри приложения запрещены: цены, «купить/оплатить/тариф/подписка/скидка», ссылки на платёжные страницы, WebView с оплатой. Разрешено: нейтральные «уровень профиля», «расширенные возможности учётной записи», кнопка «Личный кабинет» (системный браузер). Все тексты точек гейтинга — `gate.*` в i18n-каталоге; ревизия новых строк на запрещённые формулировки обязательна. На сайте (внешний веб) ограничений сторов нет.

## 6. Текущее состояние и планируемое

Реализовано: OTT-цепочка, kill-switch, Realtime/foreground-подхват, модалки, профили шлюзов RU/INT (Lava/ЮKassa), ЮKassa recurring (save method + daily cron + revoke на cancel/wipe), разовая оплата вебинара/книги, цены по гео. Планируется: читалка книги; курсы/интенсивы; годовая периодичность Lava; чеки 54-ФЗ.
