# Payment gateways (Lava.top / ЮKassa)

Два независимых шлюза — по тому же принципу, что `EMAIL_OTP` / `EMAIL_MARKETING`: у каждого свой `ENABLED` + `REGION`.

## Env (канон)

| Переменная | Значение | Смысл |
| --- | --- | --- |
| `PAYMENT_LAVATOP_ENABLED` | `true` / `false` | Вкл/выкл Lava.top |
| `PAYMENT_LAVATOP_REGION` | `INT` | Международный fallback (все страны без своего country-gateway) |
| `PAYMENT_YOOKASSA_ENABLED` | `true` / `false` | Вкл/выкл ЮKassa |
| `PAYMENT_YOOKASSA_REGION` | `RU` | Россия |
| `YOOKASSA_SHOP_ID` | shopId | Credentials магазина (не флаг маршрутизации) |
| `YOOKASSA_SECRET_KEY` | secret | API secret (не в git) |
| `YOOKASSA_RETURN_URL` | `https://zamkovoi.yoga/cabinet/?paid=1` | Return после оплаты |
| `YOOKASSA_WEBHOOK_SECRET` | опц. | Доп. проверка webhook |

**Не используем** (удалены из модели):

- `YOOKASSA_ENABLED` — дублировал `PAYMENT_YOOKASSA_ENABLED`
- `PAYMENT_GATEWAY_FOR_RUB` — заменён на `PAYMENT_*_REGION`
- `YOOKASSA_RECURRING_ENABLED` — автоплатежи всегда запрашиваются для подписок (см. ниже)

Prod (целевой режим): оба шлюза `ENABLED=true`, Lava `REGION=INT`, ЮKassa `REGION=RU`.

## Выбор шлюза

Код: `resolvePaymentGateway` в `_legacy_web/app/api/account/paymentGatewayProfile.ts`.

1. Enabled gateway с `REGION === billingCountry` (не `INT`) → он.
2. Иначе enabled gateway с `REGION=INT` → он.
3. Иначе fail-closed: кабинет без кнопок оплаты; checkout `503 payment_gateway_unavailable`.

Страна приходит из приложения (`?country=RU`) вместе с `currency`. Fallback: `currency=RUB` ⇒ `RU`.

Пример: пользователь в RU → ЮKassa; в DE → Lava; ЮKassa выключена → даже RU уходит на Lava (INT).

## Автоплатежи ЮKassa

Отдельного env-флага нет (у Lava подписки живут на стороне провайдера).

- Для **подписок** create payment всегда шлёт `save_payment_method=true`.
- Если магазин ещё не разрешил recurring (HTTP 403) → **один retry без save**: обычная оплата проходит, доступ +30 дней выдаётся; method не сохраняется.
- Когда менеджер ЮKassa включит автоплатежи на магазине → тот же код начнёт сохранять method **без смены env**.
- Cron `yookassa-renewals` всегда активен: списывает только контракты с `payment_method_id` (без сохранённого метода просто нечего renew-ить).

## Webhook ЮKassa

`https://harmonizer-ten.vercel.app/api/account/webhooks/yookassa`  
События: `payment.succeeded`, `payment.canceled`.

В кабинете ЮKassa → HTTP-уведомления этот URL **обязан** быть включён (для **текущего** shopId). Без вебхука return `?paid=1` показывает «Спасибо», но контракт остаётся `pending`.

После смены shopId проверьте, что webhook URL привязан к **новому** магазину.

## Cron рекуррента

`GET/POST /api/cron/yookassa-renewals` (`CRON_SECRET`) — ежедневно через pg_cron `run_yookassa_renewals_daily`.  
Отмена / wipe → `yookassa_payment_methods.status=inactive` (ЮKassa не удаляет method на своей стороне).

## Возвраты (админка)

- Список `/admin/payments` → «Возврат» на gateway-строке.
- **Lava:** только статус `refunded` у нас (+ исключение из net-статистики) и снятие тарифа по этому платежу. Деньги — заявка в ЛК Lava (webhook на возврат у Lava нет).
- **ЮKassa API:** `POST /v3/refunds`; статус платежа и тариф меняются **только** при `status=succeeded`. `pending`/ошибка → без изменений в БД; в модалке кнопка «Сделать возврат вручную» (`yookassa_mark`, как Lava). Вебхук `refund.succeeded` тоже помечает контракт и снимает тариф.
- После успешного возврата подписки: membership пересчитывается из оставшихся active/cancelled контрактов или ручных грантов; иначе `free`.
- Статистика: `payment_settlements.refunded_at IS NULL`.

## Апгрейд ЮKassa (Наставник → Мастер)

`bonusDays = floor(remainingDays × oracleAmount / masterAmount)` добавляются к базовым 30 суткам первого периода Master. `oracleAmount`/`masterAmount` — цены **каталога** ЮKassa (не тестовая сумма в `payment_contracts`). `remainingDays` — до max(period_end контракта, `membership_expires_at`). Превью в кабинете (`upgradeBonusDays`), если > 0. Канон каталога: oracle **950** ₽, master **4950** ₽.

## Smoke

1. RU-гео → цены из `payment_catalog` → оплата Наставник → webhook `succeeded` → контракт active (+ method `active`, если магазин уже разрешил save).
2. Cancel в кабинете → method `inactive`.
3. INT-гео → Lava.
4. Оба gateway `false` → «Оплата временно недоступна».
