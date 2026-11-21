# Личный кабинет → `https://zamkovoi.yoga/cabinet/`

## Деплой (ISPManager)

Залить содержимое этой папки в `public_html/cabinet/`:

- `index.html`
- `icons/` (favicon вкладки)

Без темы WordPress. URL приложения не меняется: `https://zamkovoi.yoga/cabinet/?ott=…`.

## Назначение

Мост app → оплата (Consumption-Only): OTT → кабинетная сессия → overview / checkout.  
API: `API_BASE` в `index.html` (Vercel). Оферта: `{API}/cabinet/offer/{lang}.json`.  
Визиты: Яндекс.Метрика `39862855` в `index.html` (async после boot).

Подробнее: `docs/02_modules/account_web/`.

## Урок по ссылке из письма

`lesson.html` → `https://zamkovoi.yoga/cabinet/lesson.html?enrollment=<UUID>&lesson=<ID>`.
Отдельная страница без входа, с одним уроком. Сверху название курса, в карточке только урок, внизу копирайт текущего года. Публиковать только этот файл рядом с index.html, без замены кабинета. API_BASE прежний; CORS задаётся существующим ACCOUNT_CABINET_ALLOWED_ORIGIN. Правила доступа/сообщение общие с Profile на сервере courses. CSS-палитра задаётся семантическими переменными в начале файла. Vimeo должен видеть Referer origin zamkovoi.yoga, поэтому не задавать для iframe no-referrer. Контент не вшит в HTML, а загружается из базы; будущие правки урока видны без повторной загрузки файла на хостинг.
