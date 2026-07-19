---
id: 02_modules/account_web/history
title: Account Web History
version: 1.5
updated: 2026-07-19
---

## 2026-07-19 — Кнопка «Личный кабинет» падала после долгого фона: упреждающий refresh JWT

- **Симптом:** после 20–30 мин в фоне кнопка «Личный кабинет» (профиль, апселл-панели, `AccountGateDialog`) падала с `gate.cabinetError` («Не удалось открыть Личный кабинет. Проверьте соединение…»), хотя переключение по вкладкам работало. Пользователь подозревал потерю геолокации («allow once»).
- **Корневая причина — не геолокация:** `resolveBillingCurrency` (единственный geo-зависимый шаг `openAccountCabinet`) перехватывает **все** ошибки гео и fallback на `EUR`; потеря «allow once» геолокации влияет только на валюту цен, не бросается. Реальная причина — протухший **access token (JWT)** Supabase: `autoRefreshToken` в мобильном клиенте выключен (`createSupabaseClient`), `startAutoRefresh()` на foreground асинхронен и не успевал до тапа, а `getSupabaseAccessSession` только читал снимок/`auth.getSession()` (supabase-js v2 не фильтрует протухшие токены и не обновляет их сам) → `POST /api/account/ott` уходил с устаревшим JWT → серверный `requireUserId` через `auth.getUser(token)` отдавал 401 → `requestOneTimeToken` бросал `account/ott HTTP 401` → UI показывал generic «проверьте соединение».
- **Фикс (в `services/supabase.ts`, модуль `profile`/auth):** `getSupabaseAccessSession` теперь при отсутствии/протухшем снимке упреждающе зовёт `auth.refreshSession()` через сериализованный `refreshAccessSessionOnce` (один refresh за раз — иначе параллельные вызовы сжигают single-use refresh token → `SIGNED_OUT`), при неудаче (нет сети / refresh token отозван) fallback на прежний путь `getSession()`. Лечит сразу все потребители Bearer JWT: `openAccountCabinet`, `dayPlan`, `geoSearchClient`, `purchasesClient`.
- **Текст ошибки:** оставлен прежний `gate.cabinetError` (по запросу автора) — ожидается, что упреждающий refresh убирает симптом; если возникнет иная ошибка, текст будет пересмотрен отдельно.
- **Документация:** `profile/spec.md` (поведение `getSupabaseAccessSession`), `profile/history.md`, эта запись.

## 2026-07-19 — Футер кабинета: ссылка «Договор оферты» + модалка с текстом договора (8 локалей)

- **Что:** в `web_cabinet/cabinet.html` под строкой копирайта `© <год> <copyrightName>` добавлена ссылка «Договор оферты» (переведена на 8 локалей в объекте `HZ_OFFER`), открывающая модальное окно с полным текстом «Договор публичной оферты и политика обработки персональных данных» (ред. 29 июля 2026).
- **Модалка:** `#hz-offer-modal` (`position:fixed` overlay, не блокирует body-scroll → нет сдвига страницы). Карточка `max-height:86vh`, тело `.hz-modal-body` с `overflow-y:auto` + `-webkit-overflow-scrolling:touch` (прокрутка пальцем), `white-space:pre-wrap` (переносы `\n` из текста). Закрытие: кнопка ×, клик по фону, Escape.
- **Восстановление фокуса:** `hzOpenOffer(srcEl)` сохраняет `window.scrollY` и саму ссылку (activeElement); `hzCloseOffer` делает `window.scrollTo(0, savedScrollY)` и `s.focus.focus({preventScroll:true})` — кабинет остаётся как был в момент клика, без сдвигов.
- **i18n:** RU-источник зашит в `HZ_OFFER.ru`; 7 локалей (EN, DE, FR, IT, ES, PT, NL) переведены one-off скриптом через DeepSeek (`AI_MODEL_PREMIUM`) с системным промптом: link — традиционное для страны название ссылки-оферты, title — содержит ту же фразу что link, компания «ТОО Сергей Замковой» → «LLP Sergei Zamkovoi» во всех переводах (в RU оставлено «ТОО Сергей Замковой»), URL/e-mail/БИН сохранены. One-off скрипты удалены после применения.
- **Проверка:** JS-синтаксис извлечённого скрипта — `node --check` OK.

## 2026-07-19 — Спасибо-модалка за вебинар при любом входе в кабинет + убрана «Отменить запись»

- **Баг:** при оплате вебинара из Личного кабинета, открытого кнопкой «Личный кабинет» в **профиле** (а не из карточки вебинара), спасибо-модалка не показывалась. Причина: эффект 2b детектил вебинар только при `cabinetVisit.ctx=webinar:<id>`, который ставится лишь при входе из экрана вебинара. Эффект 2c (книга) работал для любого ctx, но фильтровал `kind==="book"` и игнорировал вебинар.
- **Фикс:** эффекты 2b и 2c объединены в один 2bc — на foreground после визита в кабинет (с **любым** ctx) зовётся `GET /api/account/purchases/last`; если последняя one_time-покупка — вебинар или книга, оплаченная после `cabinetVisit.ts`, показывается модалка `gate.webinarPaid.*` / `gate.bookPaid.*` (ретрай 10с на задержку вебхука; флаг `purchaseThanksShown.<uid>.<contractId>`; visit чистится только после показа). Импорт `isRegistered` удалён.
- **`WebinarScreen`:** убрана кнопка «Отменить запись» (отмена без возврата денег лишена смысла; для разовой оплаты вебинара регистрация ставится вебхуком автоматически, для Master — ручная «Записаться» без отмены). `toggleRegistration` → `register` (только false→true).

## 2026-07-19 — Kill-switch `account_links_enabled`: anon-read + защита кэша от отравления

- **Симптом:** после переключения пользователя на вкладке «Профиль» пропадала кнопка «Личный кабинет», хотя в БД `app_config.account_links_enabled = true`, а оплата «Наставник» прошла корректно (`membership_tier=oracle`, `membership_expires_at` в будущем).
- **Корневая причина:** RLS на `app_config` разрешал select только `authenticated`. В окне sign-out/sign-in (или при протухшем access_token, или холодном старте до загрузки сессии) запрос от анона возвращал 0 строк, `useAccountLinksEnabled` трактовал «нет строк» как fail-safe `false` и кэшировал его на 5 минут — кнопка скрывалась на всё время TTL. К тарифу/пользователю это не относилось.
- **Фикс:**
  - Миграция `20260719000000_app_config_anon_read_account_links.sql`: доп. политика select на `app_config` для `anon, authenticated` с ограничением `using (key = 'account_links_enabled')`. Kill-switch — публичный boolean, не секрет; остальные ключи остаются gated. Применена в remote Supabase.
  - `modules/account/core/accountLinksConfig.ts`: `fetchAccountLinksEnabled` теперь возвращает `boolean | null` (`null` = «нет строк / ошибка»); `getAccountLinksEnabled` кэширует только явное значение, при `null` возвращает прежний кэш без продления TTL. Транзиентный сбой больше не отравляет кэш на 5 минут.
- **Документация:** spec §2 (`useAccountLinksEnabled`), §3 (RLS), §4 (kill-switch).

## 2026-07-18 — Lava: настоящие offerId для вебинара/книги + feedVisibility=ALL

- **Корневая причина ошибок Lava** (`Product with offer id not found`, цены null): в `payment_offers` лежали `productId` (из URL `app.lava.top/products/<productId>`), а `/api/v2/invoice` ожидает **offerId** (ID оффера). Плюс `GET /api/v2/products` без параметра не возвращает продукты «Доступ только по ссылке» — поэтому цены вебинара/книги не резолвились.
- **Решение (без «Цена по запросу API», цены из карточек Lava — единообразие сохранено):**
  - `lava.ts`: `fetchLavaProducts` теперь зовёт `/api/v2/products?feedVisibility=ALL&limit=100` — скрытые разовые товары возвращаются с офферами и ценами.
  - Миграция `20260718230000_fix_webinar_book_offer_ids.sql`: `UPDATE payment_offers` для `webinar/en` и `book/en` настоящими offerId, полученными из `GET /api/v2/products?feedVisibility=ALL` (`offers[].id`). Проверено: `POST /api/v2/invoice` (ONE_TIME) с ними возвращает 201 + `paymentUrl`, цены — из карточек (книга 19.50 €, вебинар 9.50 €).
- **Документация:** `lava_integration.md` §2 (параметр `feedVisibility=ALL`), §3.1 (где взять offerId: API и UI-способ через инкогнито→«Купить»→2-й UUID в URL), §9 (Lava-блокер решён).

## 2026-07-18 — Кабинет: правки UI + разовая покупка книги + Advisor

- **Правки `web_cabinet/cabinet.html`** по отзыву автора:
  - email в блоке «My account» — со своей строки, без ведущего дефиса.
  - английское имя тарифа «Наставник»: `Mentor` → `Advisor` (всё приложение — через `modules/i18n/catalog/en.json` `tier.oracle`/`tier.practitioner`).
  - английское название книги: «Yoga — the Wizard's Path» → «Yoga - the Way of Wisdom».
  - футер: убрана приписка «После изменения уровня вернитесь в приложение…»; вместо неё копирайт `© <текущий год> <имя>` (`new Date().getFullYear()`, ru «Сергей Замковой», прочие локали «Sergei Zamkovoi») — `I18N.copyrightName`.
  - блок вебинара «Разовое участие…» рендерится только когда есть ближайший вебинар (`overview.webinar.webinarId`) или `ctx=webinar:<id>`; иначе кнопки нет — нет ошибки «No upcoming webinar».
  - кнопки разовых покупок с ценой: вебинар «Записаться — <цена>», книга «Купить — <цена>» (`I18N.buyBtn`).
- **Разовая покупка книги (ONE_TIME):**
  - `checkout/route.ts`: `kind:"book"` → `startBookCheckout` (ONE_TIME-инвойс Lava, контракт `product_kind=one_time,tier=book,product_ref=null`).
  - Вебхук `payment.success` для one_time обобщён: вебинар — upsert `webinar_registrations`, книга — просто `status=active` (без регистрации и без изменения `membership_*`).
  - `overview-data.ts`: `AccountOverview.book = { purchase }` (цена ONE_TIME из Lava).
  - `cabinet.html`: кнопка книги ведёт на checkout (`hzStartBook`), а не на сайт.
- **Обнаружение покупки в приложении:** `GET /api/account/purchases/last` (Bearer JWT, service role) — последняя активная one_time-покупка (`{kind,productRef,createdAt,contractId}`). `modules/account/core/purchasesClient.ts`. `MembershipEventsBridge` на foreground после визита в кабинет сверяет `createdAt` книги с `cabinetVisit.ts` и показывает модалку `gate.bookPaid.*` (один ретрай через 10с на задержку вебхука; флаг `bookThanksShown.<uid>.<contractId>`).
- **i18n:** `gate.bookPaid.title`/`gate.bookPaid.body` добавлены в 8 локалей, sync-meta актуализирована (`i18n-sync check` зелёный).

## 2026-07-18 — Кабинет: редизайн + разовая оплата вебинара + провайдер-абстракция

- **Редизайн `web_cabinet/cabinet.html`** под макет автора: шапка «ИСКУССТВО ЖИТЬ / Школа Сергея Замкового», заголовок «Личный кабинет», блок «Гармонизатор» (тариф, действует до, подписка/статус/следующее списание/отмена), «Другие тарифы» (буллеты с ✓, кнопки «Подключить за …»), «Дополнительно» (разовый вебинар, книга «Подробнее», месячный интенсив с комбобоксом m1..m7). Самодостаточный CSS (без Tailwind-CDN), шрифт Hanken Grotesk. Логика показа/скрытия: «Другие тарифы» и блок вебинара скрыты для «Мастера»; демо-доступ приравнен к бесплатному для вебинара (демо не может записаться бесплатно). Все тексты — на 8 языках («искусство жить» → «the art of life» для en).
- **Разовая оплата вебинара (ONE_TIME):**
  - Миграции `20260718170000_payment_contracts_one_time.sql` (колонки `product_kind` subscription|one_time, `product_ref`; `tier` расширен до `webinar`/`book`; `periodicity` — MONTHLY|ONE_TIME) и `20260718173000_payment_offers_one_time.sql` (seed `webinar/en`, `book/en` offerId = `LAVATOP_WEBINAR_ID`/`LAVATOP_BOOK_ID`).
  - `lava.ts`: `createLavaOneTimeInvoice` (periodicity ONE_TIME), `resolveLavaOfferIdByName` (любой товар), `resolveLavaPrice` параметр `periodicity`.
  - `checkout/route.ts`: `kind` ∈ `subscription` (по умолчанию) | `webinar`; для вебинара — `webinarId` (из `ctx=webinar:<id>`, иначе ближайший опубликованный), ONE_TIME-инвойс, контракт `product_kind=one_time,tier=webinar,product_ref=<webinarId>`; если уже записан — `{alreadyRegistered:true}` без paymentUrl.
  - Вебхук `payment.success` для one_time webinar: НЕ меняет `membership_*`, а upsert `webinar_registrations(webinar_id=product_ref, user_id)`.
  - `overview-data.ts`: `AccountOverview.webinar = { webinarId, purchase }` (ближайший вебинар + цена ONE_TIME); `upgradeTiers[].purchase = { mode, price, url }`.
- **Провайдер-абстракция под RU-эквайринг:** `AccountPurchaseMode = "checkout" | "link"`. Сейчас всегда `checkout` (Lava) — `resolvePurchaseMode(currency)`. Задел: при `currency==="RUB"` вернуть `"link"` + url российского эквайринга — кабинет сам подставит внешнюю ссылку вместо POST-чеката, без правки кабинета. TODO-комментарий в `overview-data.ts`.
- **Приложение:** `WebinarScreen` повторно проверяет `isRegistered` при возврате в foreground (экран обновляется без перезапуска); `MembershipEventsBridge` — модалка «Вы записаны на вебинар» (`gate.webinarPaid.*`) при обнаружении регистрации после визита в кабинет с `ctx=webinar:<id>` (один ретрай через 10с на случай задержки вебхука). i18n-ключи добавлены в каталог (8 локалей), sync-meta актуализирована.

## 2026-07-18 — Мультиязычные продукты Lava: payment_offers + цены из Lava

- Миграция `20260718150000_payment_offers.sql`: таблица `payment_offers` (маппинг `(tier, locale) → offerId`, fallback локаль `en`; RLS без политик). Seeded: `oracle/en`, `master/en` текущими offerId. Цены НЕ хранятся — тянутся из `GET /api/v2/products` (кэш 10 мин).
- `lava.ts`: `resolveLavaOfferId(db, tier, locale)` (fallback en) и `resolveLavaPrice(db, tier, locale, currency)` (поиск оффера в продуктах Lava). `createLavaSubscriptionInvoice` принимает готовый `offerId`. Env `LAVATOP_TARIFF_2_ID/_3_ID` больше не используются сервером (оставлены для совместимости).
- `checkout`: offerId разрешается по `users.locale` с fallback `en`. `overview`/`session`: принимают `?currency=`/body `currency` и отдают `upgradeTiers[].price` (из Lava) в этой валюте; `upgradeTiers` теперь массив `{tier, price}`.
- `cabinet.html`: убран захардкоженный `PRICES`; цены и кнопки берутся из `overview.upgradeTiers[].price`; `currency` передаётся в `session` и `overview`.
- Решения продукта: один продукт Lava на язык + fallback на en (запуск с английского, добавление языков без правки кода); валюта гео-зависима и независима от языка продукта; отдельный RU-продукт в Lava не создаётся (RU идёт через Lava на английском продукте в RUB до подключения российского эквайринга).
- Новый документ `docs/02_modules/account_web/lava_integration.md` (контракт Lava, маппинг, валюты, поток, политики, env, ссылки на docs Lava).

## 2026-07-15 — Платежи Lava.top: checkout, вебхуки, отмена подписки, геовалюта

- Миграция `20260715120000_lava_payment_contracts.sql`: таблица `payment_contracts` (контракты Lava ↔ пользователи, статусы pending/active/cancelled/failed, `current_period_end`; только service role). Применена в Supabase.
- Vercel API: `POST /api/account/checkout` (создание MONTHLY-инвойса Lava `POST /api/v2/invoice`, ответ `paymentUrl`), `GET|DELETE /api/account/subscription` (текущая подписка / отмена через `DELETE /api/v1/subscriptions`), `POST /api/account/webhooks/lava` (auth по `X-Api-Key`; активация, продление, отмена; при `payment.success` нового контракта старые active-подписки пользователя отменяются — политика A3 «апгрейд немедленно, остаток без пересчёта»). `AccountOverview` дополнен полем `subscription`; `upgradeTiers` после отмены = все платные уровни. Клиент Lava — `_legacy_web/app/api/account/lava.ts` (контракт сверен с официальными SDK).
- Приложение: `resolveBillingCurrency` (reverse-geocode кэшированных координат → RU=RUB, US=USD, иначе EUR), `openAccountCabinet(ctx)` теперь передаёт `&currency=` и `&ctx=` (`tier` | `webinar:<id>` | `course:<id>` — задел) и пишет флаг `cabinetVisit` для foreground-сверки.
- `cabinet.html`: блок «Ваша подписка» (статус, цена, следующее списание / «доступ до», кнопка «Отменить подписку» с confirm и понятным текстом «доступ сохранится до конца оплаченного периода»), цены уровней в валюте из ссылки (`PRICES` дублирует офферы Lava), реальный `hzStartUpgrade` → checkout → redirect, `hzCancelSub`, refetch overview по `visibilitychange`; заготовка блока курсов (`COURSES`). Новые строки локализованы на все 8 языков внутри файла.
- Vercel env: добавлены `LAVATOP_API_KEY`, `LAVATOP_WEBHOOK_SECRET`, `LAVATOP_TARIFF_2_ID`, `LAVATOP_TARIFF_3_ID`; продовый деплой выполнен, эндпоинты отвечают 401 без auth.
- Решения продукта: цены «Мастера» 99 USD/EUR против 4950 ₽ — осознанный региональный прайсинг; годовая периодичность и курсы — следующий этап (архитектура заложена).

## 2026-07-15 — Deploy edge-функции + шрифт панелей + кнопка ЛК в профиле

- Edge-функция `send-auth-email` переписана: внешний модуль `denomailer` недоступен для бандлинга в Supabase Edge Functions → заменён на минимальный SMTP-клиент на встроенном `Deno.connectTls` (EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT, multipart/alternative с base64 subject). Функция задеплоена, секреты `SMTP_USERNAME`/`SMTP_PASSWORD` установлены на remote.
- Кнопка «Личный кабинет» добавлена в карточку доступа экрана «Профиль» (раньше была только в гейт-диалогах и upsell-панели — для trial/Master-пользователя её не было видно).
- Шрифт панелей `AccountUpsellPanel` и `UpcomingWebinarBanner` приведён к `screenHint` (15px regular) — ранее ошибочно поставлен `sectionTitle` (18px); chevron панели — `›` с rotate 90°.

## 2026-07-14 — Создание модуля (Consumption-Only, внешние платежи)

Первая реализация моста «приложение ↔ Личный кабинет на zamkovoi.yoga»:

- `modules/account/` в приложении: `openAccountCabinet` (OTT + системный браузер), kill-switch `useAccountLinksEnabled` (`app_config.account_links_enabled`, fail-safe false), `MembershipEventsBridge` (Realtime на своей строке `users` + foreground-refetch; модалки «Демонстрационный период завершён» и «Уровень профиля обновлён»), персистентные флаги `lastTier`/`trialEndedShown`.
- Vercel API `_legacy_web/app/api/account/`: `POST /ott` (одноразовый токен, sha256-хэш в БД, TTL 5 мин), `POST /session` (атомарное гашение OTT → HMAC-сессия 60 мин + overview, CORS только для zamkovoi.yoga), `GET /overview`.
- Миграция `20260714220000_web_account_ott.sql`: `web_ott_tokens`, `app_config` (+seed), `users` в publication `supabase_realtime`.
- `web_cabinet/cabinet.html` — самодостаточная страница кабинета для WordPress-блока «HTML-код» (8 локалей, заглушка оплаты `hzStartUpgrade`).

Мотивация: комиссии сторов; модель Consumption-Only с нейтральной кнопкой «Личный кабинет» (без цен и платёжных формулировок в приложении) — см. spec §5.
