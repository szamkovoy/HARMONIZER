---
id: 04_workspace/external_payments_setup
title: Внешние платежи — чек-лист настройки инфраструктуры
version: 1.0
updated: 2026-07-14
depends_on: [02_modules/account_web/spec, 02_modules/profile/spec]
code_refs: [supabase/functions/send-auth-email/index.ts, web_cabinet/cabinet.html]
---

# Чек-лист ручной настройки (выполняет владелец проекта)

Код задачи «внешние платежи / email-OTP / личный кабинет» уже в репозитории.
Ниже — шаги, которые нельзя сделать из кода: доступы, консоли, WordPress.

## 1. Яндекс 360 — почта sergei@zamkovoi.yoga

1. Создать **пароль приложения** (не основной пароль!):
   Яндекс ID → Безопасность → Пароли приложений → «Почта» → создать.
   Сохранить строку — это будет `SMTP_PASSWORD`.
2. В админке Яндекс 360 для домена zamkovoi.yoga проверить, что включён
   **IMAP/SMTP доступ** для ящика.
3. Проверить DNS-записи домена (обычно уже настроены при подключении Яндекс 360):
   - SPF: `v=spf1 redirect=_spf.yandex.net` (или include);
   - DKIM: селектор `mail._domainkey` из админки Яндекс 360;
   - DMARC (желательно): `v=DMARC1; p=none; rua=mailto:sergei@zamkovoi.yoga`.
   Без SPF/DKIM письма с кодами будут падать в спам.

## 2. Supabase — миграции, edge-функция, Auth Hook

```bash
cd /Users/sergey/Desktop/HARMONIZER
npx supabase db push                       # 20260714210000 (trial 1 день) + 20260714220000 (OTT/app_config/realtime)
npx supabase functions deploy send-auth-email
```

Секреты edge-функции (после шага 3 ниже — хук выдаст SEND_EMAIL_HOOK_SECRET):

```bash
npx supabase secrets set SMTP_USERNAME=sergei@zamkovoi.yoga
npx supabase secrets set SMTP_PASSWORD=<пароль приложения из шага 1>
npx supabase secrets set SEND_EMAIL_HOOK_SECRET=<из Dashboard после включения хука>
```

В **Dashboard → Authentication**:

1. **Sign In / Providers → Email**: включён; `Confirm email` можно оставить off —
   OTP-вход сам подтверждает адрес. **Email OTP length = 6** (стандарт).
2. **Hooks → Send Email Hook**: тип HTTPS, URL —
   `https://<project-ref>.supabase.co/functions/v1/send-auth-email`.
   После сохранения скопировать секрет (`v1,whsec_…`) в
   `SEND_EMAIL_HOOK_SECRET` (см. выше) и передеплоить функцию не нужно —
   секреты подхватываются сразу.
3. **Rate limits**: поднять «Email sent per hour» до разумного значения
   (со своим SMTP лимит Supabase не действует, но поле всё равно проверяется).

Проверка: запросить код на свой email из dev-сборки; письмо должно прийти
от `Harmonizer <sergei@zamkovoi.yoga>` с темой «123456 — ваш код входа…».

## 3. Vercel — env и деплой

```bash
cd /Users/sergey/Desktop/HARMONIZER
npx vercel env add ACCOUNT_CABINET_SECRET production        # длинная случайная строка (openssl rand -base64 48)
npx vercel env add ACCOUNT_CABINET_ALLOWED_ORIGIN production # https://zamkovoi.yoga
npx vercel --prod --yes
```

Новые роуты: `/api/geo/search`, `/api/account/ott`, `/api/account/session`,
`/api/account/overview`.

## 4. WordPress — страница /cabinet/

1. Создать страницу `https://zamkovoi.yoga/cabinet/` (шаблон без сайдбара).
2. Добавить блок **«HTML-код»** и вставить содержимое `web_cabinet/cabinet.html`
   целиком.
3. Открыть страницу без параметров — должна показать «Личный кабинет
   открывается по ссылке из приложения…». Затем проверить полный путь из
   приложения (кнопка «Личный кабинет»).
4. Исключить страницу из кэширующих плагинов (если стоят) — она сама ходит в API.

## 5. App Review (Apple / Google)

1. Перед отправкой сборки на ревью — выключить kill-switch:
   `update public.app_config set value = 'false' where key = 'account_links_enabled';`
   Все кнопки «Личный кабинет» исчезнут (останется «Закрыть»). После
   прохождения ревью вернуть `'true'` — без нового релиза.
2. Демо-аккаунт для ревьюера: создать пользователя, выдать вечный `master`
   через админ-леджер, указать email в App Review Information. Код входа
   ревьюеру не придёт — поэтому для ревью либо оставить konto с известным
   ящиком, доступным вам (переслать код по запросу нельзя), либо использовать
   ящик вида `review@zamkovoi.yoga`, к которому у вас есть доступ, и указать
   в примечаниях, что код приходит на этот адрес мгновенно.
3. В анкетах сторов: приложение бесплатное, покупок внутри нет; внешние
   ссылки — только «управление учётной записью».

## 6. Порядок включения

1. Яндекс (шаг 1) → Supabase (шаг 2) → проверка входа по OTP в dev.
2. Vercel (шаг 3) → WordPress (шаг 4) → проверка перехода в кабинет из dev.
3. Сборка → ревью с выключенным kill-switch (шаг 5) → включение после апрува.
