---
id: 02_modules/notifications/dependencies
title: Notifications Dependencies
version: 1.4
updated: 2026-08-16
depends_on: [02_modules/admin_panel/spec, 02_modules/webinars/spec]
code_refs:
  [
    modules/notifications/core/pushRegistration.ts,
    modules/notifications/core/notificationPermissionPolicy.ts,
    _legacy_web/app/api/admin/notifications/segment.ts,
    services/localNotifications.ts,
  ]
---

## 1. Зависит от

- **`admin_panel`** — отправка только из `/admin/notifications` под `requireAdmin` (service role).
- **`webinars`** — сегмент `webinar:<id>` читает `webinar_registrations`; список вебинаров для селекта — `GET /api/admin/webinars`. Клиентский `WebinarScreen` вызывает `ensureNotificationPermission("webinar")` при записи / уже записан.
- **`subscription`** — сегмент `tier:<t>` фильтрует по сырому `users.membership_tier` (не effective tier — истёкший грант остаётся в своём тарифе до фикса данных).
- **`infra`** — Supabase (`push_tokens`, `notifications`, `notification_deliveries`), weekly prune + minutely `notify-webinar-start` в `ensure_harmonizer_cron_jobs`, Expo Push, EAS `projectId`. Android remote: FCM.
- **`services/localNotifications.ts`** — ленивый загрузчик `expo-notifications` (`getExpoNotificationsOrNull`), `ensureAndroidNotificationChannels` (`harmonizer_opportunity_high` / `harmonizer_remote`), общий с локальными напоминаниями.
- **`services/androidExactAlarms.ts`** — Android 12+ exact-alarm check (`PermissionsAndroid` / AppOp) + `expo-intent-launcher` `REQUEST_SCHEDULE_EXACT_ALARM`; используется из `OpportunityWindows.saveReminder`.
- **FCM (Android remote):** локальный `google-services.json` в корне (**gitignore**, в архив EAS — через `.easignore`; шаблон `.example`) **и** EAS file-env `GOOGLE_SERVICES_JSON` (иначе cloud build без FCM); FCM V1 key в EAS credentials (`scripts/upload-fcm-to-eas.mjs`); чекер `scripts/android-fcm-setup.mjs`. Project Firebase: `harmonizer-777`.
- **Firebase iOS (App Check):** `GoogleService-Info.plist` (gitignore + `.easignore`) / EAS file-env `GOOGLE_SERVICES_PLIST` → `ios.googleServicesFile`. Без файла iOS-сборка пропускает RNFirebase plugins.
- **auth / i18n** — userId для токена и доставок; ключи `notifications.*`; язык remote push = exact `users.locale` via `resolveExactNotificationCopy` / `pickExactLocalizedText` (soft `pickLocalizedText` только для inbox).

## 2. От него зависят

- **`profile`** — в «Мои данные» подпись + кликабельная цифра непрочитанных → `/my-notifications` (`app/(tabs)/profile.tsx`).
- **Корневой layout** — `PushRegistrationBridge` в `app/_layout.tsx`.
- **Home** (`app/(tabs)/index.tsx`) — мягкий `ensureNotificationPermission("home")` на focus.
- **OpportunityWindows** — перед `ensureNotificationPermission("opportunity_bell")` закрывает модалку «Уведомить»; при `granted` — `registerPushToken`; иначе Alert + «Открыть настройки». На Android 12+ дополнительно `ensureAndroidExactAlarmsForOpportunityReminders` до `scheduleNotificationAsync`. Sync не cancel’ит late OS alarms до grace 3ч после события.

## 3. Контрактные точки риска

- **Схема `push_tokens` — легаси из init-миграции** (`is_active`, `expo_token`, `last_seen_at`): регистрация клиента и выборка рассылки согласованы на ней; менять только синхронно.
- **`data.url` в push** — контракт между `expoPush.ts` и listener в `PushRegistrationBridge`.
- **Строка `segment`** (`all` / `tier:*` / `webinar:*`) парсится `segment.ts`; новые сегменты добавлять там же + в select админки.
- **RLS notifications** завязана на существование delivery-строки: удаление рассылки каскадно прячет её у всех получателей.
