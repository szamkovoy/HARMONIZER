---
id: 02_modules/account_web/history
title: Account Web History
version: 1.1
updated: 2026-07-15
---

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
