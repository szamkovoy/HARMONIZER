---
id: 02_modules/notifications/history
title: Notifications History
version: 1.2
updated: 2026-07-22
depends_on: [02_modules/admin_panel/spec]
code_refs: [supabase/migrations/20260708150000_notifications.sql]
---

## Decision Log

- **2026-07-23 (google-services.json out of git):** GitHub secret scanning: public leak `google_api_key` in committed `google-services.json` (`ed1705d`). File removed from tracking + `.gitignore`; template `google-services.json.example`. **Owner must rotate/restrict the leaked Android API key in Google Cloud Console** and close the alert as revoked. Local file stays for builds; not committed.

- **2026-07-23 (Android FCM live):** Firebase project `harmonizer-777`; `google-services.json` в корне; FCM V1 service account загружен в EAS и назначен на `com.zamkovoi.harmonizer` (`scripts/upload-fcm-to-eas.mjs`). Rebuild Android development client обязателен для получения Expo push token на устройстве.

- **2026-07-22 (Android FCM wiring):** `app.config.ts` ставит `googleServicesFile` при наличии файла; `ensureAndroidNotificationChannels` await; скрипт `android-fcm-setup.mjs`. Файлы Firebase / EAS FCM key — у владельца (open_questions).

- **2026-07-22 (Android remote gap):** QA: админ-рассылка дошла на iPhone (app killed), не на Pixel (app open, OS permission granted via bell). Root cause кандидаты: (1) в проекте нет FCM/`google-services.json` — Android Expo token не выдаётся, iOS APNs ок; (2) колокольчик запрашивал permission, но не вызывал `registerPushToken` (фикc; Home/webinar уже вызывали). Payload: `channelId: harmonizer_remote`. FCM wiring — open_questions.

- **2026-07-22 (permission policy):** Единый `ensureNotificationPermission(reason)`: мягкий запрос на Главной (cooldown 7 дн. после отказа), колокольчик окон — без cooldown, вебинар (запись / уже записан после оплаты) — cooldown 3 дн. `PushRegistrationBridge` / `registerPushToken` больше не вызывают системный диалог сами. Онбординг не спрашивает. Docs §3.1.

- **2026-07-14 (inbox nav + hang):** «Все уведомления» могло висеть на лоадере (auth ещё `initializing` / запрос без таймаута). Back с пуш-ридера оставлял полупустой Home + splash. Фикс: wait auth, timeout 12s, `replace` stack, title «Уведомление», unread accent / read muted; inbox остаётся только admin deliveries.

- **2026-07-14 (admin delete logout):** Удаление рассылки в админке разлогинивало и не удаляло — logout на любой сбой `/me` + bodyless DELETE. UI теперь POST `{action:delete}` на `[id]`; DELETE оставлен; ответ 404 если строки нет.

- **2026-07-14 (push open + terminated):** Admin `TypeError: terminated` = undici/Vercel socket close after Expo accept (send still OK). Hardened Expo fetch + admin UI recovery. Tap opens `/push-message` with full body + links (cold start via getLastNotificationResponseAsync).

- **2026-07-14 (token claim):** Root cause Russian push for Italian profile: sole iOS token owned by another `users.locale=ru` account; RLS blocked re-claim. Added `claim_push_token` + `resolveNotificationCopy` as single locale entry for remote pushes.

- **2026-07-14 (locale sync):** Root cause Russian push with Italian UI: `users.locale` lagged SecureStore. hydrate/setAppLocale/registerPushToken always write-back; Expo adds `interruptionLevel: active`.

- **2026-07-14:** Expo push всегда `sound: "default"` + `priority: high`. Admin notifications: i18n как Video + DELETE; send по `users.locale` (preferred→en→ru). Inbox резолвит тем же helper. Миграция `20260714110000`.

- **2026-07-13:** Relative timestamps on `MyNotificationsScreen` use shared `formatRelativeTime` (Hermes-safe, all 8 locales).

- **2026-07-08:** Модуль реализован end-to-end (этап 4 админ-панели). Решения: **двойная доставка** — Expo push + обязательная строка в `notification_deliveries`, из которой строится экран «Мои уведомления» (требование владельца: сообщение со ссылкой на запись вебинара должно дойти и без push-разрешений); `push_tokens` из init-миграции переиспользована как есть (клиент до этого этапа в неё не писал); рассылка синхронная в роуте (`maxDuration 120`) — очередь не нужна при текущем масштабе; `DeviceNotRegistered` деактивирует токен (`is_active=false`); сегменты — строка `all|tier:*|webinar:*` (webinar-сегмент читает регистрации этапа 3); контент рассылки — авторский, без перевода; receipts Expo не сверяются (осознанно, single-author масштаб). E2E-смоук: send(tier:oracle) → delivery под RLS → mark read → history → каскадная зачистка.
