# Личный кабинет → `https://zamkovoi.yoga/cabinet/`

## Деплой (ISPManager)

Залить содержимое этой папки в `public_html/cabinet/`:

- `index.html`
- `icons/` (favicon вкладки)

Без темы WordPress. URL приложения не меняется: `https://zamkovoi.yoga/cabinet/?ott=…`.

## Назначение

Мост app → оплата (Consumption-Only): OTT → кабинетная сессия → overview / checkout.  
API: `API_BASE` в `index.html` (Vercel). Оферта: `{API}/cabinet/offer/{lang}.json`.

Подробнее: `docs/02_modules/account_web/`.
