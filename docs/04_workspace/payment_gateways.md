# Payment gateways (Lava.top / ЮKassa)

Независимые профили шлюзов — по тому же принципу, что `EMAIL_OTP` / `EMAIL_MARKETING`.

## Env

| Переменная | Значение | Смысл |
| --- | --- | --- |
| `PAYMENT_LAVATOP_ENABLED` | `true` / `false` | Вкл/выкл Lava |
| `PAYMENT_LAVATOP_REGION` | `INT` | Международный (все страны, если нет country-specific) |
| `PAYMENT_YOOKASSA_ENABLED` | `true` / `false` | Вкл/выкл ЮKassa |
| `PAYMENT_YOOKASSA_REGION` | `RU` | Россия |
| `YOOKASSA_SHOP_ID` | `1415612` | shopId магазина |
| `YOOKASSA_SECRET_KEY` | secret | API secret (не в git) |
| `YOOKASSA_RETURN_URL` | `https://zamkovoi.yoga/cabinet/?paid=1` | Return после оплаты |
| `YOOKASSA_RECURRING_ENABLED` | `true` / `false` | `save_payment_method` + daily renew cron |
| `YOOKASSA_WEBHOOK_SECRET` | опц. | Доп. проверка webhook |

Legacy (если новых `PAYMENT_*_ENABLED` нет): `YOOKASSA_ENABLED` + `PAYMENT_GATEWAY_FOR_RUB=yookassa`.

## Выбор шлюза

1. Enabled gateway с `REGION === billingCountry` (не `INT`).
2. Иначе enabled gateway с `REGION=INT`.
3. Иначе fail-closed: кабинет без кнопок оплаты; checkout `503 payment_gateway_unavailable`.

Страна приходит из приложения (`?country=RU`) вместе с `currency`. Fallback: `currency=RUB` ⇒ `RU`.

## Webhook ЮKassa

`https://harmonizer-ten.vercel.app/api/account/webhooks/yookassa`  
События: `payment.succeeded`, `payment.canceled`.

## Cron рекуррента

`GET/POST /api/cron/yookassa-renewals` (`CRON_SECRET`) — ежедневно через pg_cron `run_yookassa_renewals_daily`.  
Отмена / wipe → `yookassa_payment_methods.status=inactive` (ЮKassa не удаляет method на своей стороне).

## Smoke

1. RU-гео → цены из `payment_catalog` → оплата Наставник → method `active` в БД.
2. Cancel в кабинете → method `inactive`.
3. INT-гео → Lava.
4. Оба gateway `false` → «Оплата временно недоступна».
