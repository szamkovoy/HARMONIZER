---
id: 04_workspace/payments_audit_2026-11-12
title: Аудит платёжного модуля (Lava.top / ЮKassa) — находки и план исправлений
updated: 2026-11-12
author: Claude (Cowork), по коду ветки chore/migration-journal-repair + журнал вебхуков Lava от Сергея
status: живая БД и логи Vercel НЕ проверялись (нет доступа) — пункты «проверить SQL» обязательны
---

# 0. Как пользоваться

Документ — задание для исполнителя (Cursor, любая модель). У каждой находки есть: где (файл:строка), что не так, как чинить, как проверить.
Порядок: §2 (срочно руками) → §3 P0 → §4 P1 → §5 P2. После P0 вернуть Claude на ревью диффа.
Пути без префикса — от `_legacy_web/app/api/account/`.

# 1. Выводы по двум обращениям

## 1.1 Аудроне (audrone.leisenberger@gmail.com) — причина в нашем коде, вероятность ~90%

Цепочка:
1. Подписка Master с 10.08, продления 09.09 и 09.10 прошли. Следующее списание — 08.11 ~19:32 МСК.
2. Lava сделала 3 попытки (08.11 19:3x, +8 ч, +24 ч). Вебхук `subscription.recurring.payment.failed` Lava шлёт ТОЛЬКО по последней попытке (документация Lava) — это запись «Неуспешное продление подписки 10.11 03:42 DELIVERED». `subscription.cancelled` после этого НЕ пришёл.
3. Наш обработчик (`webhooks/lava/route.ts:93-96`) на это событие ничего не делает («ждём retries/cancelled»). Контракт навсегда остался `status='active'` с `current_period_end` в прошлом.
4. Через 48 ч грейса `reconcile_expired_memberships` → `restore_membership_from_ledger` считает `active`-контракт действующим без проверки даты → пишет `membership_tier='master'` с истёкшей датой; приложение показывает «Навигатор» (дата в прошлом), кабинет — «Подписка 99 €/мес АКТИВНА, следующее списание 8 ноября».
5. Тупик: `tierCheckout.ts:94-106 blockedReason` видит `active` Master → любой тариф (Наставник, Мастер, 30 дней) = 409 `already_active` → её скриншот «Requested tier is not higher than the active subscription». `/pay/failed` в этом состоянии редиректит в кабинет с `?paid=1` («Спасибо за оплату») — `payPages.ts:163,202`.

Почему не прошло само списание — вне нашего кода (списывает Lava/Unlimint). Нужен `errorMessage` из карточки вебхука 10.11 03:42. «Банк не видел попыток» = отказ на стороне эквайера/токена карты до авторизации у эмитента (или первая линия банка не видит MIT-отказы). Письмо «автоплатёж не проходит» отправила Lava: в нашем коде такого письма нет.

Под тем же тупиком: любая Lava-подписка после неуспешного продления и ЮKassa-подписка без сохранённого метода (`payment_method_id is null`) либо старше 7 дней после конца периода.

## 1.2 Попова (elenapopovastore@gmail.com) — вероятнее всего не наш код (~75%)

- Скриншоты: `app.lava.top` → Visa «Processing…» и `cardpay.com … notification, Zero KB`. cardpay.com = Unlimint (эквайер Lava). Ответ 3‑D Secure (`notification`) открылся верхним уровнем как пустой файл: шаг 3DS сломался на стороне Lava/Unlimint до ввода кода. После редиректа на `paymentUrl` наш код в процессе не участвует.
- Разовые 15 € проходят без challenge (low-value exemption), подписка сохраняет карту → обязательный challenge → он и ломается. Это объясняет «вебинар да, подписка нет» той же картой.
- 15%: встроенный браузер (SFSafariViewController / Custom Tabs): popup/iframe 3DS, возврат из приложения банка. Проверка: открыть кабинет в обычном Safari/Chrome и оформить подписку той же картой.
- 10%: наши параметры инвойса.
- Что отправить в Lava: contractId неудачных счетов (SQL Q7), оба скриншота, вопрос «почему notification 3DS отдаётся пустым top-level ответом; есть ли frictionless/redirect-режим для MONTHLY».

Показывается ли страница с 3 кнопками — НЕ подтверждено. Поля `successful_return_url/failure_return_url/cancel_return_url` в документации Lava есть (developers.lava.top), но описаны рядом с `/api/v3/invoice`; мы шлём их в `/api/v2/invoice` (`lava.ts:274-291`). Для PayPal документация называет поле `paymentProvider`, мы шлём `paymentMethod` (`lava.ts:290`). См. P1-6.

## 1.3 Что видно из журнала вебхуков Lava

- Строки с именем «—» и статусом FAILED (по ~20 на каждое событие) — второй, мёртвый адрес вебхука. Проверить список вебхуков в ЛК Lava, удалить лишний. Шум, но не вред.
- Продления 09.09 и 09.10: Lava продолжала повторы ПОСЛЕ статуса DELIVERED (все 19 попыток). Значит обработчик продления отвечал не 2xx или дольше 10 с. В `handleRenewal` (`route.ts:257-302`) расчёт курса (`settlePayment` → внешний запрос Т‑Банк/ЦБ) идёт до ответа. Продление записывалось (идемпотентно), но это тот же риск, что 06.11: если ни одна попытка не уложится — оплаченное продление потеряется, человек упадёт на free. Сверки для продлений нет. См. P1-1, P1-2.
- До 07.11 (адрес `vercel.app`) доставки опаздывали до 72 минут (21.10, 30.10), одна потеряна (06.11). После переноса на `harmonizer.zamkovoi.yoga` — DELIVERED с первой попытки.

# 2. Срочно, руками (до кода)

1. Аудроне. Вариант А (без SQL): попросить её нажать в кабинете «Отменить подписку», затем оформить заново. Вариант Б — SQL:
```sql
update payment_contracts
   set status='cancelled', cancelled_at=now(), updated_at=now(),
       failure_reason=coalesce(failure_reason,'renewal failed 2026-11-10; lapsed manually')
 where buyer_email='audrone.leisenberger@gmail.com'
   and product_kind='subscription' and status='active' and current_period_end < now();
update users set membership_tier='free', membership_expires_at=null
 where id in (select user_id from payment_contracts where buyer_email='audrone.leisenberger@gmail.com')
   and membership_expires_at < now();
```
   После Б: в ЛК Lava убедиться, что её подписка не активна (иначе отменить там), чтобы не было двойных списаний.
2. Выполнить SQL-пакет §6 (только SELECT) и приложить результат.
3. В ЛК Lava открыть карточку вебхука 10.11.2026 03:42 → прислать `errorMessage` и тело.

# 3. P0 — логические ошибки (чинить первыми, одной веткой)

## P0-1. «Вечный active»: подписка без продления не закрывается
Правило (единое, вынести в `subscriptionLiveness.ts` + SQL-функцию): подписочный контракт ДЕЙСТВУЕТ ⇔ `status='active'` AND `current_period_end + 48h > now()`.

Правки:
- a) `webhooks/lava/route.ts:93-96` — `subscription.recurring.payment.failed` терминален: найти контракт по `parentContractId || contractId`; `status='cancelled'`, `cancelled_at=now`, `failure_reason='renewal: '+errorMessage`; `users.membership_*` не трогать (доживёт грейс); вызвать `cancelLavaSubscription` (404 ок, ошибки только логировать) — после ответа (`scheduleAfterResponse`); письмо пользователю и админу (P1-3, P1-4).
- b) Страховочная зачистка. Новая SQL-функция `lapse_stale_subscriptions()` в новой миграции, вызывать из `reconcile_expired_memberships` перед циклом:
```sql
update public.payment_contracts
   set status='cancelled', cancelled_at=now(), updated_at=now(),
       failure_reason=coalesce(failure_reason,'lapsed: no renewal')
 where coalesce(product_kind,'subscription')='subscription'
   and status='active' and current_period_end is not null
   and current_period_end < now() - interval '72 hours';
```
  Для строк `provider='lavatop'` дополнительно нужен вызов Lava DELETE: в `lavaReconcile.ts` добавить шаг «active lavatop subscription с `current_period_end < now()-48h`» → `cancelLavaSubscription` → `cancelled`; SQL-зачистка остаётся сеткой на 72 ч. Для `yookassa` — `yookassa_payment_methods.status='inactive'` (как `cancelProviderSubscription`).
- c) Миграция: `restore_membership_from_ledger` (последняя версия — `supabase/migrations/20260728144628_…sql`) — в выборке контрактов заменить `c.status = 'active'` на `(c.status='active' and (c.current_period_end is null or c.current_period_end + interval '48 hours' > now()))`. Заодно учесть 30-дневные пропуска: `product_kind='one_time' and product_ref='pass_30d' and status='active' and current_period_end > now()` (без +48h) — сейчас при любом пересчёте (возврат, reattach) пропуск теряется.
- d) `tierCheckout.ts:94-106` — в запросе `active` добавить `.gt('current_period_end', now-48h)` (или фильтр в коде по правилу).
- e) `overview-data.ts:157-182` — не отдавать `subscription`, если `current_period_end + 48h < now` (для `active`) или `current_period_end < now` (для `cancelled`): кабинет покажет «Навигатор» без блока подписки и все тарифы. `candidateTiers` считать от действующего тарифа.
- f) `subscription/route.ts:24-36` — добавить `.eq('product_kind','subscription')` (сейчас берётся последняя строка любого вида, в т.ч. вебинар/книга).
- g) Одноразовая чистка данных — запрос из (b) без ожидания 72 ч, после сверки списка Q2 с ЛК Lava.
Проверка: тест — контракт active с period_end = now−3d ⇒ `blockedReason` = null, overview.subscription = null, restore ⇒ free; вебхук recurring.failed ⇒ cancelled + failure_reason.

## P0-2. Покупка подписки помечает разовые покупки как cancelled
`webhooks/lava/route.ts:222-246`: выборка «прочих active» без фильтра `product_kind` → книга/вебинар/пропуск получают `cancelled` (книга «исчезает»: `bookOwnership.ts` ищет active), а в Lava уходит DELETE по разовому счёту. В `fulfillPaymentContract.ts:120-122` фильтр есть.
Чинить: удалить собственную ветку подписки в `route.ts:194-249`, всегда делегировать в `fulfillFirstPaymentSuccess(..., scheduleSlow)` (там же ответ до медленной части). Данные: Q3 → вернуть `status='active', cancelled_at=null` пострадавшим one_time.

## P0-3. Активация не атомарна: «оплатил, тариф не выдан»
`fulfillPaymentContract.ts:283-314` (и `activateTierPass:369-381`, и `route.ts:203-219`): сначала контракт → `active`, потом `users`. Если второй запрос упал (таймаут 4 с, 504 Supabase — у проекта это бывало), Lava повторит, но повтор уходит в ветку `status==='active'` (`:174-201`) и `users` уже не обновляет.
Чинить: одна SQL-функция `activate_subscription_contract(p_contract_id, p_period_end, p_access_until)` (обе записи в одной транзакции), либо в ветке `alreadyActive` идемпотентно довыдавать доступ (если `users.membership_expires_at < current_period_end`). Проверка данных: Q5.

# 4. P1 — надёжность и сопровождение

- P1-1. `handleRenewal` (`route.ts:257-302`): ответ сразу после двух записей; `settleLavaCharge` и `resubscribe` — в `scheduleAfterResponse`. Не воскрешать контракт, отменённый пользователем (сейчас `cancelled` → `active`); если продление пришло по cancelled — продлить доступ, статус оставить, написать админу.
- P1-2. Сверка продлений: для active lavatop-подписок с `current_period_end` в прошлом (0–48 ч) спросить Lava о факте оплаты. Точку API уточнить в Swagger `https://gate.lava.top/docs` (кандидаты: `GET /api/v1/invoices/{id}` по parent, список продаж/подписок). Без этого потерянный вебхук успешного продления = снятый оплаченный тариф.
- P1-3. Журнал событий: таблица `payment_events(id, created_at, provider, event_type, contract_id, parent_contract_id, buyer_email, amount, currency, status, error_message, raw jsonb, handled_result jsonb, http_status)`; писать из обоих вебхуков, сверок, checkout-отказов (409/4xx/5xx, `LavaInvoiceError`) и `/pay/retry`. Сейчас всё только в `console.log` Vercel (живёт недолго). `lavaReconcile.ts:79-87` ставит `failed` без `failure_reason` — писать `'reconcile: invoice FAILED'`.
- P1-4. Письмо админу (szamkovoy@gmail.com, адрес — в env `PAYMENT_ALERT_EMAIL`) на: `payment.failed`, `recurring.failed`, зачистку (P0-1b), ошибку создания счёта, ЮKassa canceled/renewal fail. Состав: время в поясе админа (Europe/Moscow), email + ссылка `/admin/users/<id>`, продукт/тариф, сумма+валюта, шлюз, contractId, `failure_reason`, сырой JSON события. Отправлять после ответа вебхуку. Дедуп по `contract_id+event_type`.
- P1-5. Админка `/admin/payments`: вкладка «Неуспешные» по `payment_contracts`: `failed` (карта введена, отказ: причина), `cancelled` с `failure_reason like 'renewal%' / 'lapsed%'`, отдельно «брошенные» — `pending` старше 30 мин (страницу открыл, оплату не завершил; до 07.11 часть реальных отказов тоже осталась pending из-за недоставленных вебхуков). Ночной перевод `pending` старше 24 ч в новый статус `abandoned` (миграция CHECK) — чтобы не копились.
- P1-6. Проверить на живом счёте: (1) доходит ли человек до `/pay/failed` после отказа (тест картой с неверным CVC, тариф Наставник); если нет — перейти на `/api/v3/invoice` или уточнить у Lava; (2) кнопка PayPal реально открывает PayPal (`paymentMethod` vs `paymentProvider`); (3) у вебинара/книги (`checkout/route.ts:217,266`) return-URL не передаются вообще — добавить success → кабинет `?paid=1`.
- P1-7. Письмо пользователю при неуспешном продлении/зачистке со ссылкой `/pay/renew?t=` (страница уже есть: другая карта / PayPal / 30 дней). Сейчас человек получает только письмо Lava и тупик.
- P1-8. Кабинет (`web_cabinet/cabinet/index.html:671-689`): показывать локализованный текст по `code` (`already_active`, `has_subscription`, `higher_access`, `payment_gateway_unavailable`), а не сырой английский `error`.
- P1-9. ЮKassa, сдвиг периода: `yookassaRenewals.ts:9` списывает за 36 ч до конца, `fulfillYookassaRenewal` (`fulfillPaymentContract.ts:530-531`) считает новый период от даты списания → цикл ~28,5 дня. Считать от `max(старый current_period_end, paidAt) + 30d`.
- P1-10. ЮKassa, ложная отмена: `yookassaRenewals.ts:185-193` — сетевая ошибка/таймаут запроса считается отказом; 2 сбоя ⇒ подписка отменена. Считать отказом только `canceled` от ЮKassa; исключения — лог + письмо админу, без счётчика.

# 5. P2

- Не обрабатываются `refund.success`, `chargeback.initiated` Lava (возврат в ЛК Lava не снимает доступ) — `route.ts:99-100`.
- `fetch` к Lava без таймаута (`lava.ts:178,274,311,329`) — добавить `AbortSignal.timeout(8000)`.
- `reconcile_expired_memberships` каждый час заново обрабатывает одни и те же «зависшие» строки (уйдёт после P0-1c).
- `handleRenewal` перезаписывает `membership_tier` тарифом контракта, даже если у человека действует более высокий (пропуск/грант).
- Документация: обновить `docs/02_modules/account_web/{spec,lava_integration,history}.md`, `subscription/spec.md`, CHANGELOG (правило P0-1, терминальность recurring.failed).

# 6. SQL-пакет (только чтение) — выполнить и вернуть результат

```sql
-- Q1 Аудроне
select c.contract_id,c.provider,c.tier,c.product_kind,c.status,c.created_at,c.current_period_end,c.cancelled_at,c.failure_reason,
       u.membership_tier,u.membership_expires_at
from payment_contracts c left join users u on u.id=c.user_id
where c.buyer_email='audrone.leisenberger@gmail.com' order by c.created_at;

-- Q2 все «вечные active»
select c.buyer_email,c.provider,c.tier,c.contract_id,c.current_period_end,c.payment_method_id is not null as has_method,
       u.membership_tier,u.membership_expires_at
from payment_contracts c left join users u on u.id=c.user_id
where coalesce(c.product_kind,'subscription')='subscription' and c.status='active' and c.current_period_end < now()
order by c.current_period_end;

-- Q3 разовые покупки, ошибочно помеченные cancelled (P0-2)
select buyer_email,tier,product_ref,contract_id,created_at,cancelled_at from payment_contracts
where product_kind='one_time' and status='cancelled' order by cancelled_at;

-- Q4 картина отказов с августа
select provider,product_kind,tier,status,coalesce(failure_reason,'—') reason,count(*),count(distinct buyer_email) buyers
from payment_contracts where created_at>='2026-08-01' group by 1,2,3,4,5 order by 1,2,3,6 desc;

-- Q4b по людям: попытки подписки и исход
select buyer_email,count(*) attempts,count(*) filter (where status in ('active','cancelled')) paid,
       count(*) filter (where status='failed') failed,count(*) filter (where status='pending') pending,
       min(created_at) first_try,max(created_at) last_try,
       string_agg(distinct failure_reason,' | ') reasons
from payment_contracts where created_at>='2026-08-01' and product_kind='subscription'
group by 1 order by last_try desc;

-- Q5 оплачено, но доступ не выдан/короче оплаченного (P0-3)
select c.buyer_email,c.tier,c.contract_id,c.current_period_end,u.membership_tier,u.membership_expires_at
from payment_contracts c join users u on u.id=c.user_id
where c.status='active' and c.current_period_end>now()
  and (c.product_kind='subscription' or c.product_ref='pass_30d')
  and (u.membership_tier is distinct from c.tier or u.membership_expires_at is null or u.membership_expires_at < c.current_period_end);

-- Q6 расчёты по продлениям Аудроне (сколько раз записано)
select s.* from payment_settlements s
where s.contract_id in (select contract_id from payment_contracts where buyer_email='audrone.leisenberger@gmail.com');

-- Q7 Попова: хронология
select created_at,updated_at,tier,product_kind,product_ref,currency,amount,status,failure_reason,contract_id
from payment_contracts where buyer_email='elenapopovastore@gmail.com' order by created_at;
```

# 7. План работ

1. §2 руками (Аудроне, SQL-пакет, errorMessage). 
2. Ветка `fix/payments-lapse-and-activation`: P0-1…P0-3 + тесты (vitest рядом с `payRetry.test.ts`) + миграция + docs. Ревью Claude.
3. P1-3 → P1-4 → P1-5 (журнал, письма, админка) — одна ветка.
4. P1-1, P1-2, P1-6…P1-10.
5. Вопросы в Lava: (a) что происходит с подпиской после финального неуспешного продления и почему нет `subscription.cancelled`; (b) API для статуса подписки/последнего списания по parentContractId; (c) 3DS/cardpay notification у Поповой; (d) работают ли return-URL в v2.

# 8. Дополнение 2026-11-13 — данные из живой БД (SQL §6 выполнен Claude, только чтение)

- Q1/Q2: «вечный active» ровно один — Аудроне, контракт `e5167608-c022-4e2b-8bf4-88b03bd970dc`, `current_period_end=2026-11-08T16:32Z`, `users.membership_tier='free'`. Вебхук 10.11: `status:"subscription-failed"`, `errorMessage:"Bank's malfunction"`, наш ответ 200 `noted`. Подписка в Lava мертва (двойного списания не будет).
- Q3: разовых покупок со статусом `cancelled` нет — P0-2 данные пока не испортил (ошибка в коде остаётся).
- Q5: «оплачено, доступ не выдан» — пусто.
- Живая `restore_membership_from_ledger` совпадает с миграцией `20260728144628` (active без проверки даты) — P0-1c актуален.
- `/pay/failed` работает: в БД есть 30-дневный пропуск со статусом failed (создаётся только с этой страницы), у Поповой успешный счёт создан через 2 минуты после отказа 09.11. P1-6(1) снят; PayPal-поле (P1-6(2)) проверить остаётся.
- Конверсия подписки с августа (без тестовых адресов): ~25 человек вводили данные, оплатили ~10, причём половина — со 2–11-й попытки (meira 11, popova 9). До 08.11 `failure_reason` не писался, причина отказов неизвестна; с 08.11 у Поповой — `Declined by 3-D Secure`.
