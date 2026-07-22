---
id: 02_modules/notifications/spec
title: Notifications Spec
version: 1.4
updated: 2026-07-22
depends_on: [02_modules/admin_panel/spec, 02_modules/infra/spec, 02_modules/i18n/spec, 02_modules/webinars/spec]
code_refs:
  [
    modules/notifications/index.ts,
    modules/notifications/core/pushRegistration.ts,
    modules/notifications/core/notificationPermissionPolicy.ts,
    modules/notifications/core/notificationPermissionStore.ts,
    modules/notifications/core/notificationsClient.ts,
    modules/notifications/ui/PushRegistrationBridge.tsx,
    modules/notifications/ui/MyNotificationsScreen.tsx,
    modules/home/ui/OpportunityWindows.tsx,
    modules/webinars/ui/WebinarScreen.tsx,
    app/(tabs)/index.tsx,
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
    scripts/android-fcm-setup.mjs,
    app.config.ts,
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
- **`PushRegistrationBridge`** — после логина / `AppState=active` вызывает `registerPushToken` **без** системного диалога (только если уже granted); тап по push → **`router.replace("/push-message")`**.
- **`ensureNotificationPermission(reason)`** — единая политика запроса OS-разрешения (см. §3.1).
- **`registerPushToken(userId)`** — sync UI → `users.locale`; **`claim_push_token` RPC**; **не** вызывает `requestPermissionsAsync`.
- **`PushMessageScreen`** / **`MyNotificationsScreen`** / Профиль — без изменений контракта inbox.
- Точки запроса UI: Главная (`home`), колокольчик окон (`opportunity_bell`), экран вебинара при записи / уже записан (`webinar`).

**Админка (гейт `requireAdmin`):**

- `GET/POST /api/admin/notifications`, `DELETE|POST …/[id]` (удаление; UI шлёт POST `{action:"delete"}`).
- POST: recipients → row + i18n → deliveries → Expo через `resolveNotificationCopy` + `truncatePushBody` + data `{notificationId,title,body,url}` + `sound`/`priority`/`interruptionLevel` + Android `channelId: harmonizer_remote`. Expo fetch: `Connection: close`, timeout, полный consume body (защита от `TypeError: terminated` на Vercel). UI при обрыве сети после успеха — показывает «рассылка сохранена» по истории.

## 3. Данные

- **`push_tokens`** + RPC **`claim_push_token`** (`20260714130000`).
- **`notifications`** / **`notification_deliveries`**.
- Клиентские флаги cooldown (SecureStore / localStorage): `harmonizer.notif.perm.lastSoftAskAt`, `…lastWebinarAskAt`.

### 3.1 Политика запроса разрешения (алгоритм)

Единая точка: `ensureNotificationPermission(reason)` → при `granted` вызывающий код делает `registerPushToken`.

| reason | Когда | Поведение |
| --- | --- | --- |
| `home` | Фокус вкладки Главная (авторизован) | Мягкий запрос. Если `undetermined` — спросить (повтор не чаще 7 дн.). Если уже denied и `canAskAgain` — снова только после 7 дн. Если ОС больше не показывает диалог — skip. |
| `opportunity_bell` | Сохранение напоминания колокольчиком | Явный жест: спросить сразу (без cooldown). При отказе — Alert «нужно разрешение» (как раньше). |
| `webinar` | Нажал «Записаться» **или** экран вебинара при `registered=true` (в т.ч. после оплаты в кабинете) | Контекстный запрос, не чаще **1 раза в 3 дня** (чтобы не дёргать при каждом возврате к ссылке на комнату). |

**Не спрашиваем:** в онбординге; из `PushRegistrationBridge` при логине/foreground (только claim токена если уже granted).

**Зачем уведомления сейчас:** remote-рассылки админа (inbox работает и без разрешения); локальные колокольчики окон возможностей. **Будущее:** напоминание о старте вебинара — та же регистрация токена / то же разрешение; планировщик напоминания — отдельная задача.

## 4. i18n

UI — `notifications.*`. **Язык любого remote push** = только `resolveNotificationCopy(users.locale, …)` (не язык ОС телефона). Локальные окна возможностей — `getAppLocale()` + `getHomeStrings` при schedule (тот же принцип «язык профиля/приложения»). Будущие webinar reminders — тот же helper.

## 5. Известные ограничения

- Синхронная serverless-рассылка; при тысячах получателей — очередь.
- Пуш не догоняет токены, зарегистрированные после рассылки.
- Expo receipts не сверяются.
- Inbox ≠ все пуши устройства: только строки `notification_deliveries`. Напоминания окон возможностей (колокольчик) — локальный `expo-notifications`, в inbox не пишутся.
- Текст системного iOS-диалога разрешений **не редактируется** (ограничение Apple); pre-permission Alert сознательно не используем (откат 2026-07-18).
- Если пользователь навсегда запретил уведомления в настройках ОС (`canAskAgain=false`), повторный системный диалог невозможен — только ручное включение в Settings.
- **Android remote push требует FCM:** разрешение ОС + локальные напоминания (колокольчик) работают без Firebase; доставка **админских** push через Expo Push на Android — только при локальном `google-services.json` в native build (`app.config.ts` подхватывает файл из корня; **не в git** — см. `google-services.json.example`) и FCM v1 credentials в EAS. Чекер: `node scripts/android-fcm-setup.mjs`. Без этого `getExpoPushTokenAsync` на Android падает.
- **Android channels:** `ensureAndroidNotificationChannels()` создаёт `harmonizer_opportunity_high` и `harmonizer_remote` (в Settings → категории могут быть под «Показать неиспользуемые», пока ни одно уведомление не пришло).
