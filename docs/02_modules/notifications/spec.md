---
id: 02_modules/notifications/spec
title: Notifications Spec
version: 1.9
updated: 2026-08-03
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
    supabase/migrations/20260724190000_cleanup_stale_notification_deliveries.sql,
    supabase/migrations/20260724193000_inbox_kinds_and_webinar_start.sql,
    supabase/functions/notify-webinar-start/index.ts,
  ]
---

## 1. Назначение (продукт)

Рассылки владельца + авто-события: push через Expo **плюс копия** в **«Недавние уведомления»** (`/my-notifications`, лимит **10**). Inbox объединяет `kind`: `admin` (ручная рассылка), `webinar_start` (авто в `starts_at`), `opportunity` (сработавший локальный колокольчик). Вход с Профиля: «Уведомления:» + цифра. Этап 4 плана админ-панели + авто-старт вебинара.

## 2. Публичный контракт

**Клиент (`modules/notifications`, barrel `index.ts`):**

- **`resolveExactNotificationCopy` / `resolveNotificationLocale`** — язык **отправки** remote push + deliveries (клиент mirror + сервер `_legacy_web/app/api/_utils/notificationCopy.ts`). Только точный текст для `users.locale` (RU-колонка или `title_i18n[L]`); иначе получатель **пропускается** (нет EN→RU).
- **`resolveNotificationCopy`** — soft preferred → en → ru для **отображения** уже доставленных строк в inbox.
- **`PushRegistrationBridge`** — после логина / `AppState=active` вызывает `registerPushToken` **без** системного диалога (только если уже granted); тап по push → **`router.replace("/push-message")`**.
- **`ensureNotificationPermission(reason)`** — единая политика запроса OS-разрешения (см. §3.1).
- **`registerPushToken(userId)`** — **await** sync UI → `users.locale`, затем **`claim_push_token` RPC**; **не** вызывает `requestPermissionsAsync`.
- **`PushMessageScreen`** / **`MyNotificationsScreen`** / Профиль — без изменений контракта inbox.
- Точки запроса UI: Главная (`home`), колокольчик окон (`opportunity_bell`), экран вебинара при записи / уже записан (`webinar`).

**Админка (гейт `requireAdmin`):**

- `GET /api/admin/notifications?page=&limit=50&user_id=` — список (`created_at desc`, page/limit); filter по delivery `user_id`.
- `POST /api/admin/notifications` `{draft:true,…}` — черновик (`sent_at=null`); без `draft` — create+send сразу (точечный push с карточки пользователя).
- `GET/PATCH …/[id]` — detail / правка черновика; `POST …/[id]` `{action:"send"|"delete"}` (DELETE тоже удаляет). Send: `sendNotification.ts` — сегмент → exact copy → deliveries → Expo (`truncatePushBody`, data `{notificationId,title,body,url}`, Android `channelId: harmonizer_remote`). Ответ: `skipped_no_locale_copy`. eligible=0 → 400. Уже отправленные — 409 на send/PATCH.
- UI list-first как рассылки: `/admin/notifications` + «Новое», infinite scroll по страницам API; редактор `/admin/notifications/[id]` (черновик: locale strip + Сохранить/Отправить; после send — KPI read-only).

## 3. Данные

- **`push_tokens`** + RPC **`claim_push_token`** (`20260714130000`).
- **`notifications`** (только admin broadcast) / **`notification_deliveries`** (`id` PK; `kind`; nullable `notification_id`; snapshot `title`/`body`/`link_url`; `source_key` для идемпотентности personal).
- **`record_inbox_notification`** — authenticated RPC для `kind=opportunity`.
- **Webinar start:** `webinars.start_notified_at`; Edge `notify-webinar-start` minutely (`ensure_harmonizer_cron_jobs`); текст по `users.locale` + exact название вебинара; нужен `join_url`.
- **Retention:** `cleanup_stale_notification_deliveries` — deliveries старше **30 дней**, weekly `37 4 * * 0`.
- Клиентские флаги cooldown: `harmonizer.notif.perm.lastSoftAskAt`, `…lastWebinarAskAt`.

### 3.1 Политика запроса разрешения (алгоритм)

Единая точка: `ensureNotificationPermission(reason)` → при `granted` вызывающий код делает `registerPushToken`.

| reason | Когда | Поведение |
| --- | --- | --- |
| `home` | Фокус вкладки Главная (авторизован) | Мягкий запрос. Если `undetermined` — спросить (повтор не чаще 7 дн.). Если уже denied и `canAskAgain` — снова только после 7 дн. Если ОС больше не показывает диалог — skip. |
| `opportunity_bell` | Сохранение напоминания колокольчиком | Явный жест: сначала закрыть модалку «Уведомить», затем системный `requestPermissionsAsync` (без cooldown). Кастомный Alert — только если ОС не выдала `granted` (отказ или `canAskAgain=false`); в Alert — «Открыть настройки». Имя приложения в тексте — `common.appName` через `{appName}`. |
| `webinar` | Нажал «Записаться» **или** экран вебинара при `registered=true` (в т.ч. после оплаты в кабинете) | Контекстный запрос, не чаще **1 раза в 3 дня** (чтобы не дёргать при каждом возврате к ссылке на комнату). |

**Не спрашиваем:** в онбординге; из `PushRegistrationBridge` при логине/foreground (только claim токена если уже granted).

**Зачем уведомления:** remote admin; авто-старт вебинара (remote); локальные окна → inbox при срабатывании. Разрешение по-прежнему нужно для push; inbox admin/webinar_start пишется на сервере и без разрешения.

## 4. i18n

UI — `notifications.*`. **Язык remote push / delivery** = `resolveExactNotificationCopy(users.locale, …)` (не язык ОС). Нет точного перевода — пользователь не в рассылке. Inbox может soft-resolve для старых строк. Локальные окна возможностей — `getAppLocale()` + `getHomeStrings`.

## 5. Известные ограничения

- Синхронная serverless-рассылка; при тысячах получателей — очередь.
- Пуш не догоняет токены, зарегистрированные после рассылки.
- Expo receipts не сверяются.
- Inbox = `notification_deliveries` (admin + webinar_start + opportunity при fire). Локальный schedule окон остаётся на устройстве; в inbox попадает при received/tap.
- Текст системного iOS-диалога разрешений **не редактируется** (ограничение Apple); pre-permission Alert сознательно не используем (откат 2026-07-18).
- Если пользователь навсегда запретил уведомления в настройках ОС (`canAskAgain=false`), повторный системный диалог невозможен — только ручное включение в Settings.
- **Android remote push требует FCM:** разрешение ОС + локальные напоминания (колокольчик) работают без Firebase; доставка **админских** push через Expo Push на Android — только если native build включает `google-services.json`: локально файл в корне (gitignore; в EAS-архив попадает через `.easignore`), на EAS — file-env **`GOOGLE_SERVICES_JSON`** (`app.config.ts` → `android.googleServicesFile`), плюс FCM V1 service account в EAS credentials. Чекер: `node scripts/android-fcm-setup.mjs`. Без файла в билде `getExpoPushTokenAsync` на Android падает → в `push_tokens` нет android-строк → рассылка шлёт только iOS.
- **iOS Firebase App Check:** `GoogleService-Info.plist` (локально / EAS file-env **`GOOGLE_SERVICES_PLIST`**) → `ios.googleServicesFile`. Без файла `app.config.ts` пропускает `@react-native-firebase/*` на iOS prebuild (иначе hard-fail); App Check на iPhone в таком IPA выключен.
- **Android channels:** `ensureAndroidNotificationChannels()` создаёт `harmonizer_opportunity_high` и `harmonizer_remote` (в Settings → категории могут быть под «Показать неиспользуемые», пока ни одно уведомление не пришло).
