---
id: 04_workspace/external_payments_setup
title: Внешние платежи — чек-лист настройки инфраструктуры
version: 1.1
updated: 2026-07-23
depends_on: [02_modules/account_web/spec, 02_modules/profile/spec, 04_workspace/email_providers]
code_refs: [supabase/functions/send-auth-email/index.ts, web_cabinet/cabinet/index.html]
---

# Чек-лист ручной настройки (выполняет владелец проекта)

Код задачи «внешние платежи / email-OTP / личный кабинет» уже в репозитории.
Ниже — шаги, которые нельзя сделать из кода: доступы, консоли, хостинг.

**OTP-почта:** канон провайдеров, DNS (Resend + SES tails) и переключение —
`docs/04_workspace/email_providers.md`.

## 1. Почта — входящий ящик Яндекс 360 + исходящий OTP (Resend)

Входящая почта `sergei@zamkovoi.yoga` остаётся на **Яндекс 360** (MX/SPF/DKIM
`mail._domainkey` на апексе). Исходящие OTP **не** идут через SMTP Яндекса.

1. В Resend верифицировать домен **`zamkovoi.yoga`** и добавить DNS из их UI
   (`resend._domainkey` + MAIL FROM `send` MX/TXT) — см. `email_providers.md` §3.
2. Создать API-ключ только для yoga → `RESEND_ZAMKOVOI_YOGA_API_KEY`
   (отдельно от будущего marketing-ключа `RESEND_ZAMKOVOI_RU_API_KEY` на `zamkovoi.ru`).
3. DMARC на апексе (желательно): `v=DMARC1; p=none; rua=mailto:sergei@zamkovoi.yoga`.
4. **Amazon SES tails** (3 DKIM CNAME + `sesmail` MX/TXT) пока **не удалять** —
   запасной канал; список в `email_providers.md` §4.

## 2. Supabase — миграции, edge-функция, Auth Hook

```bash
cd /Users/sergey/Desktop/HARMONIZER
npx supabase db push
npx supabase functions deploy send-auth-email
```

Секреты edge-функции (хук выдаст `SEND_EMAIL_HOOK_SECRET`):

```bash
npx supabase secrets set AUTH_EMAIL_PROVIDER=resend
npx supabase secrets set RESEND_ZAMKOVOI_YOGA_API_KEY=<из .env.local / Resend>
npx supabase secrets set MAIL_FROM_EMAIL=sergei@zamkovoi.yoga
npx supabase secrets set SEND_EMAIL_HOOK_SECRET=<из Dashboard после включения хука>
# AMAZON SES TAIL — оставить, не unset, пока не бросаем SES:
# SES_ACCESS_KEY_ID / SES_SECRET_ACCESS_KEY / SES_REGION=eu-west-1
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
   (свой провайдер лимит Supabase SMTP не использует, но поле всё равно проверяется).

Проверка: запросить код из dev-сборки; письмо от
`Сергей Замковой <sergei@zamkovoi.yoga>` (или `Sergei Zamkovoi` вне RU).
В исходнике: `DKIM-Signature` с `s=resend` (не SES-токен), без предупреждения
Yandex про чужой домен. Переключение на SES — `email_providers.md` §2.

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
