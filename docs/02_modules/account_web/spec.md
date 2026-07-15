---
id: 02_modules/account_web/spec
title: Account Web (Личный кабинет) Spec
version: 1.1
updated: 2026-07-15
depends_on: [02_modules/subscription/spec, 02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/account/index.ts,
    modules/account/core/openAccountCabinet.ts,
    modules/account/core/billingCurrency.ts,
    modules/account/core/accountLinksConfig.ts,
    modules/account/core/accountFlagsStore.ts,
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
    _legacy_web/app/api/account/webhooks/lava/route.ts,
    web_cabinet/cabinet.html,
    supabase/migrations/20260714220000_web_account_ott.sql,
    supabase/migrations/20260715120000_lava_payment_contracts.sql,
    app/_layout.tsx,
  ]
---

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
- **`useAccountLinksEnabled(): boolean`** / **`getAccountLinksEnabled()`** — kill-switch из `app_config` (кэш 5 мин; fail-safe: при ошибке чтения — `false`, кнопки скрыты).
- **`MembershipEventsBridge`** — компонент без UI-поверхности (кроме модалок), монтируется один раз в `app/_layout.tsx` под `AuthProvider`.

Внутреннее (не экспортируется из barrel): `core/accountFlagsStore.ts` — персистентные флаги (`lastTier.{userId}`, `trialEndedShown.{userId}`) в SecureStore/localStorage.

### API `_legacy_web/app/api/account/*`

| Роут | Auth | Назначение |
| --- | --- | --- |
| `POST /api/account/ott` | Bearer JWT Supabase (приложение) | Выдаёт OTT: 32 байта base64url, в БД только sha256-хэш, TTL 5 мин |
| `POST /api/account/session` | без auth, body `{ ott }`, CORS = origin сайта | Атомарно гасит OTT (`UPDATE … WHERE used_at IS NULL`), возвращает `{ sessionToken, overview }` |
| `GET /api/account/overview` | Bearer кабинетной сессии | Свежий `overview` (обновление после оплаты) |
| `POST /api/account/checkout` | Bearer кабинетной сессии, body `{ tier, currency }` | Создаёт подписочный инвойс Lava (`POST gate.lava.top/api/v2/invoice`, MONTHLY) + строку `payment_contracts` (pending); отвечает `{ paymentUrl, contractId }`. При активной подписке разрешён только уровень выше её (409 иначе) |
| `GET /api/account/subscription` | Bearer кабинетной сессии | Последний контракт со статусом active/cancelled |
| `DELETE /api/account/subscription` | Bearer кабинетной сессии | Отмена подписки в Lava (`DELETE /api/v1/subscriptions?contractId&email`) + статус cancelled; доступ у пользователя остаётся до `current_period_end`. Ответ `{ cancelled, accessUntil }` |
| `POST /api/account/webhooks/lava` | заголовок `X-Api-Key` = `LAVATOP_WEBHOOK_SECRET` | Приём событий Lava (см. §3.1) |

Кабинетная сессия — компактный HMAC-SHA256 токен (`payload.sig`, TTL 60 мин, секрет `ACCOUNT_CABINET_SECRET`); прав хватает на чтение overview и операции с собственной подпиской. `AccountOverview`: `displayName`, `email`, `registeredAt`, `locale`, `tier` (practitioner наружу отдаётся как `oracle`), `trialActive/-ExpiresAt`, `membershipExpiresAt`, `upgradeTiers` (уровни выше текущего; после отмены подписки — все платные), `subscription` (`contractId`, `tier`, `currency`, `amount`, `status active|cancelled`, `currentPeriodEnd`, `cancelledAt`; null без оплат).

## 3. Внутренняя архитектура

- **БД** (`20260714220000_web_account_ott.sql`): `web_ott_tokens` (RLS без политик — только service role), `app_config` (RLS: select для authenticated, insert/update для админов; seed `account_links_enabled=true`), `users` добавлена в publication `supabase_realtime`.
- **БД** (`20260715120000_lava_payment_contracts.sql`): `payment_contracts` (user_id, contract_id unique, tier oracle|master, currency, amount, status pending|active|cancelled|failed, current_period_end, cancelled_at; RLS без политик — только service role).
- **`MembershipEventsBridge`**: (а) Realtime UPDATE своей строки `users` → `refreshProfile()`; (б) foreground — выборка membership-полей и `refreshProfile()` только при изменении отпечатка; (в) сравнение `baseTierFromRow` с сохранённым `lastTier` → модалка повышения уровня («{from} → {to}», `gate.tierChanged.*`); (г) `trial_expires_at` в прошлом при free-базе → одноразовая модалка `gate.trialEnded.*` (кнопки «Закрыть» / «Личный кабинет»).
- **Страница кабинета** (`web_cabinet/cabinet.html`): читает `?ott`, `?lang`, `?currency`, `?ctx`, сразу вычищает `ott` из адресной строки, меняет его на сессию, рендерит шапку (имя, дата регистрации, уровень, сроки), блок «Ваша подписка» (уровень, статус active/cancelled, цена, дата следующего списания / «доступ до», кнопка «Отменить подписку» с confirm), карточки доступных уровней с ценами в валюте из ссылки (константа `PRICES` дублирует офферы Lava — при смене цен в Lava обновить и её) и блок вебинаров. `hzStartUpgrade(tier)` → `POST checkout` → redirect на `paymentUrl`; `hzCancelSub()` → `DELETE subscription`. По `visibilitychange` (возврат со страницы оплаты) страница перезапрашивает overview. Заготовка блока курсов/интенсивов — массив `COURSES` (пока пуст). Деплой = копипаст файла в WordPress-блок «HTML-код».

### 3.1 Поток оплаты Lava.top

1. Кабинет: `hzStartUpgrade(tier)` → `POST /api/account/checkout {tier, currency}` → строка `payment_contracts` (pending) → redirect на `paymentUrl` Lava.
2. Вебхуки (`POST /api/account/webhooks/lava`, тело `{ eventType, contractId, parentContractId?, buyer{email}, amount, currency, status, timestamp }`):
   - `payment.success` — контракт → active, `current_period_end = +30 дней`; `users.membership_tier = tier`, `membership_expires_at = period_end + 48ч грейс` (окно ретраев списания Lava); все прочие active-контракты пользователя отменяются в Lava и в БД (политика A3: апгрейд немедленно, без пересчёта остатка);
   - `payment.failed` — pending → failed;
   - `subscription.recurring.payment.success` — сдвиг периода и `membership_expires_at` (ключ — `parentContractId`);
   - `subscription.recurring.payment.failed` — только лог (Lava ретраит сама);
   - `subscription.cancelled` — контракт → cancelled; `users.membership_*` не трогаем — доступ живёт до `membership_expires_at`, дальше `paidAccess` вернёт free.
   Неизвестный контракт — ответ 200 (ретраи бессмысленны), транзиентная ошибка БД — 5xx (Lava повторит, до 20 попыток).
3. Подхват в приложении — Realtime/foreground `MembershipEventsBridge` (модалка «Уровень профиля обновлён»).
4. Даунгрейд = отмена + новая подписка после конца периода (в кабинете после отмены показываются все платные уровни).

## 4. Конфигурация

- Vercel env: `ACCOUNT_CABINET_SECRET` (обязателен), `ACCOUNT_CABINET_ALLOWED_ORIGIN` (default `https://zamkovoi.yoga`), `LAVATOP_API_KEY`, `LAVATOP_WEBHOOK_SECRET`, `LAVATOP_TARIFF_2_ID` (offerId «Наставник»), `LAVATOP_TARIFF_3_ID` (offerId «Мастер»).
- Приложение: `EXPO_PUBLIC_ACCOUNT_CABINET_URL` (default `https://zamkovoi.yoga/cabinet/`).
- Страница: константа `API_BASE` в `cabinet.html` (origin Vercel).
- Kill-switch: `update app_config set value='false' where key='account_links_enabled'` перед отправкой сборки на ревью; `'true'` после прохождения. Без релиза приложения (кэш клиента — до 5 минут).

## 5. Комплаенс-политика текстов (инвариант)

Внутри приложения запрещены: цены, «купить/оплатить/тариф/подписка/скидка», ссылки на платёжные страницы, WebView с оплатой. Разрешено: нейтральные «уровень профиля», «расширенные возможности учётной записи», кнопка «Личный кабинет» (системный браузер). Все тексты точек гейтинга — `gate.*` в i18n-каталоге; ревизия новых строк на запрещённые формулировки обязательна. На сайте (внешний веб) ограничений сторов нет.

## 6. Текущее состояние и планируемое

Реализовано: OTT-цепочка, kill-switch, Realtime/foreground-подхват, модалки, оплата подписок через Lava.top (checkout → paymentUrl → вебхуки → `payment_contracts`/`users.membership_*`), отмена подписки из кабинета, цены по геовалюте. Планируется: разовая оплата вебинара (`ctx="webinar:<id>"` уже прокидывается), курсы/интенсивы (массив `COURSES` в cabinet.html), годовая периодичность (Lava поддерживает PERIOD_YEAR — достаточно завести цены в оффере и передавать periodicity).
