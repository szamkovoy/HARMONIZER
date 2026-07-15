# Личный кабинет на zamkovoi.yoga

`cabinet.html` — самодостаточный HTML+JS-блок для WordPress. Деплой = скопировать
весь файл в блок «HTML-код» на странице `https://zamkovoi.yoga/cabinet/`.

## Как это работает

1. Приложение (кнопка «Личный кабинет») делает `POST /api/account/ott` и открывает
   системный браузер: `https://zamkovoi.yoga/cabinet/?ott=…&lang=…`.
2. Страница меняет OTT на кабинетную сессию: `POST {API}/api/account/session`
   (CORS ограничен доменом сайта). OTT одноразовый, TTL 5 минут.
3. Ответ содержит `overview` (имя, дата регистрации, уровень, доступные уровни) —
   страница рендерит его на локали пользователя (8 языков зашиты в файл).
4. `GET {API}/api/account/overview` c Bearer-токеном сессии — обновление данных
   после оплаты (сессия 60 минут).

Прямой заход без `?ott=` показывает подсказку «Откройте кабинет из приложения».

## Конфигурация

- В `cabinet.html` константа `API_BASE` — origin Vercel-бэкенда
  (сейчас `https://harmonizer-ten.vercel.app`).
- Env на Vercel:
  - `ACCOUNT_CABINET_SECRET` — секрет HMAC кабинетных сессий (любая длинная строка);
  - `ACCOUNT_CABINET_ALLOWED_ORIGIN` — origin сайта (default `https://zamkovoi.yoga`).
- В приложении опционально `EXPO_PUBLIC_ACCOUNT_CABINET_URL`
  (default `https://zamkovoi.yoga/cabinet/`).

## Платёжная система

Кнопки уровней вызывают `hzStartUpgrade(tier)` — сейчас заглушка с сообщением
«оплата скоро будет доступна». Платёжный провайдер подключается сюда на
следующем этапе (создание платежа + вебхук на Vercel, который обновляет
`users.membership_tier` — приложение подхватит смену уровня через Realtime).
