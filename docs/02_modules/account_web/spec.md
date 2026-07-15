---
id: 02_modules/account_web/spec
title: Account Web (Личный кабинет) Spec
version: 1.0
updated: 2026-07-14
depends_on: [02_modules/subscription/spec, 02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/infra/spec]
code_refs:
  [
    modules/account/index.ts,
    modules/account/core/openAccountCabinet.ts,
    modules/account/core/accountLinksConfig.ts,
    modules/account/core/accountFlagsStore.ts,
    modules/account/ui/MembershipEventsBridge.tsx,
    modules/access/ui/AccountGateDialog.tsx,
    modules/access/ui/AccountUpsellPanel.tsx,
    _legacy_web/app/api/account/_utils.ts,
    _legacy_web/app/api/account/overview-data.ts,
    _legacy_web/app/api/account/ott/route.ts,
    _legacy_web/app/api/account/session/route.ts,
    _legacy_web/app/api/account/overview/route.ts,
    web_cabinet/cabinet.html,
    supabase/migrations/20260714220000_web_account_ott.sql,
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

- **`openAccountCabinet(): Promise<void>`** — `POST /api/account/ott` (Bearer JWT приложения) → `Linking.openURL("https://zamkovoi.yoga/cabinet/?ott=…&lang=…")`. Бросает ошибку при недоступности OTT (UI показывает `gate.cabinetError`).
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

Кабинетная сессия — компактный HMAC-SHA256 токен (`payload.sig`, TTL 60 мин, секрет `ACCOUNT_CABINET_SECRET`); прав хватает только на чтение overview. `AccountOverview`: `displayName`, `email`, `registeredAt`, `locale`, `tier` (practitioner наружу отдаётся как `oracle`), `trialActive/-ExpiresAt`, `membershipExpiresAt`, `upgradeTiers` (только выше текущего, из `VISIBLE_PAID_PRODUCT_TIERS`).

## 3. Внутренняя архитектура

- **БД** (`20260714220000_web_account_ott.sql`): `web_ott_tokens` (RLS без политик — только service role), `app_config` (RLS: select для authenticated, insert/update для админов; seed `account_links_enabled=true`), `users` добавлена в publication `supabase_realtime`.
- **`MembershipEventsBridge`**: (а) Realtime UPDATE своей строки `users` → `refreshProfile()`; (б) foreground — выборка membership-полей и `refreshProfile()` только при изменении отпечатка; (в) сравнение `baseTierFromRow` с сохранённым `lastTier` → модалка повышения уровня («{from} → {to}», `gate.tierChanged.*`); (г) `trial_expires_at` в прошлом при free-базе → одноразовая модалка `gate.trialEnded.*` (кнопки «Закрыть» / «Личный кабинет»).
- **Страница кабинета** (`web_cabinet/cabinet.html`): читает `?ott` и `?lang`, сразу вычищает `ott` из адресной строки, меняет его на сессию, рендерит шапку (имя, дата регистрации, уровень, сроки), карточки уровней выше текущего и блок вебинаров. Платёжная точка входа — `hzStartUpgrade(tier)` (пока заглушка). Деплой = копипаст файла в WordPress-блок «HTML-код».

## 4. Конфигурация

- Vercel env: `ACCOUNT_CABINET_SECRET` (обязателен), `ACCOUNT_CABINET_ALLOWED_ORIGIN` (default `https://zamkovoi.yoga`).
- Приложение: `EXPO_PUBLIC_ACCOUNT_CABINET_URL` (default `https://zamkovoi.yoga/cabinet/`).
- Страница: константа `API_BASE` в `cabinet.html` (origin Vercel).
- Kill-switch: `update app_config set value='false' where key='account_links_enabled'` перед отправкой сборки на ревью; `'true'` после прохождения. Без релиза приложения (кэш клиента — до 5 минут).

## 5. Комплаенс-политика текстов (инвариант)

Внутри приложения запрещены: цены, «купить/оплатить/тариф/подписка/скидка», ссылки на платёжные страницы, WebView с оплатой. Разрешено: нейтральные «уровень профиля», «расширенные возможности учётной записи», кнопка «Личный кабинет» (системный браузер). Все тексты точек гейтинга — `gate.*` в i18n-каталоге; ревизия новых строк на запрещённые формулировки обязательна. На сайте (внешний веб) ограничений сторов нет.

## 6. Текущее состояние и планируемое

Реализовано: OTT-цепочка, kill-switch, Realtime/foreground-подхват, модалки, страница кабинета с заглушкой оплаты. Планируется: подключение платёжного провайдера (создание платежа из `hzStartUpgrade` + вебхук на Vercel, пишущий `payments`/`users.membership_*`), разовая оплата вебинара, запись на вебинар со страницы кабинета.
