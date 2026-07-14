---
id: 02_modules/notifications/spec
title: Notifications Spec
version: 1.1
updated: 2026-07-14
depends_on: [02_modules/admin_panel/spec, 02_modules/infra/spec, 02_modules/i18n/spec, 02_modules/webinars/spec]
code_refs:
  [
    modules/notifications/index.ts,
    modules/notifications/core/pushRegistration.ts,
    modules/notifications/core/notificationsClient.ts,
    modules/notifications/ui/PushRegistrationBridge.tsx,
    modules/notifications/ui/MyNotificationsScreen.tsx,
    app/my-notifications.tsx,
    app/_layout.tsx,
    app/(tabs)/profile.tsx,
    _legacy_web/app/admin/notifications/page.tsx,
    _legacy_web/app/api/admin/notifications/route.ts,
    _legacy_web/app/api/admin/notifications/[id]/route.ts,
    _legacy_web/app/api/admin/notifications/expoPush.ts,
    _legacy_web/app/api/admin/notifications/segment.ts,
    _legacy_web/app/api/_utils/contentLocaleFallback.ts,
    services/localNotifications.ts,
    supabase/migrations/20260423080000_init.sql,
    supabase/migrations/20260708150000_notifications.sql,
    supabase/migrations/20260714110000_notifications_i18n_and_feed_locale_fallback.sql,
  ]
---

## 1. Назначение (продукт)

Рассылки владельца сегментам пользователей: push через Expo **плюс гарантированная копия** в списке «Мои уведомления» в Профиле — сообщение (например, ссылка на запись вебинара) доходит и при выключенных push-разрешениях. Этап 4 плана админ-панели.

## 2. Публичный контракт

**Клиент (`modules/notifications`, barrel `index.ts`):**

- **`resolveNotificationCopy` / `resolveNotificationLocale`** — **единая точка** языка уведомлений (клиент: `modules/notifications/core/resolveNotificationCopy.ts`; сервер: `_legacy_web/app/api/_utils/notificationCopy.ts`). Вход: `users.locale` (remote) или UI-локаль (inbox). Цепочка текста: preferred → en → ru.
- **`PushRegistrationBridge`** — после логина и при `AppState=active` вызывает `registerPushToken`; тап по push (в т.ч. cold start через `getLastNotificationResponseAsync`) → экран **`/push-message`** с полным текстом и кликабельными ссылками (`LinkifiedBody` + кнопка `link_url`).
- **`PushMessageScreen`** — ридер сообщения из push; ссылка «Все уведомления» → inbox.
- **`registerPushToken(userId)`** — sync UI → `users.locale`; **`claim_push_token` RPC**.
- **`MyNotificationsScreen`** — inbox через `resolveNotificationCopy`.
- **Профиль** — «Мои уведомления» с бейджем.

**Админка (гейт `requireAdmin`):**

- `GET/POST /api/admin/notifications`, `DELETE|POST …/[id]` (удаление; UI шлёт POST `{action:"delete"}`).
- POST: recipients → row + i18n → deliveries → Expo через `resolveNotificationCopy` + `truncatePushBody` + data `{notificationId,title,body,url}` + `sound`/`priority`/`interruptionLevel`. Expo fetch: `Connection: close`, timeout, полный consume body (защита от `TypeError: terminated` на Vercel). UI при обрыве сети после успеха — показывает «рассылка сохранена» по истории.

## 3. Данные

- **`push_tokens`** + RPC **`claim_push_token`** (`20260714130000`).
- **`notifications`** / **`notification_deliveries`**.

## 4. i18n

UI — `notifications.*`. **Язык любого remote push** = только `resolveNotificationCopy(users.locale, …)` (не язык ОС телефона). Локальные окна возможностей — `getAppLocale()` + `getHomeStrings` при schedule (тот же принцип «язык профиля/приложения»). Будущие webinar reminders — тот же helper.

## 5. Известные ограничения

- Синхронная serverless-рассылка; при тысячах получателей — очередь.
- Пуш не догоняет токены, зарегистрированные после рассылки.
- Expo receipts не сверяются.
