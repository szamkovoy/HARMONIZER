---
id: 02_modules/notifications/history
title: Notifications History
version: 1.0
updated: 2026-07-08
depends_on: [02_modules/admin_panel/spec]
code_refs: [supabase/migrations/20260708150000_notifications.sql]
---

## Decision Log

- **2026-07-14 (push open + terminated):** Admin `TypeError: terminated` = undici/Vercel socket close after Expo accept (send still OK). Hardened Expo fetch + admin UI recovery. Tap opens `/push-message` with full body + links (cold start via getLastNotificationResponseAsync).

- **2026-07-14 (token claim):** Root cause Russian push for Italian profile: sole iOS token owned by another `users.locale=ru` account; RLS blocked re-claim. Added `claim_push_token` + `resolveNotificationCopy` as single locale entry for remote pushes.

- **2026-07-14 (locale sync):** Root cause Russian push with Italian UI: `users.locale` lagged SecureStore. hydrate/setAppLocale/registerPushToken always write-back; Expo adds `interruptionLevel: active`.

- **2026-07-14:** Expo push всегда `sound: "default"` + `priority: high`. Admin notifications: i18n как Video + DELETE; send по `users.locale` (preferred→en→ru). Inbox резолвит тем же helper. Миграция `20260714110000`.

- **2026-07-13:** Relative timestamps on `MyNotificationsScreen` use shared `formatRelativeTime` (Hermes-safe, all 8 locales).

- **2026-07-08:** Модуль реализован end-to-end (этап 4 админ-панели). Решения: **двойная доставка** — Expo push + обязательная строка в `notification_deliveries`, из которой строится экран «Мои уведомления» (требование владельца: сообщение со ссылкой на запись вебинара должно дойти и без push-разрешений); `push_tokens` из init-миграции переиспользована как есть (клиент до этого этапа в неё не писал); рассылка синхронная в роуте (`maxDuration 120`) — очередь не нужна при текущем масштабе; `DeviceNotRegistered` деактивирует токен (`is_active=false`); сегменты — строка `all|tier:*|webinar:*` (webinar-сегмент читает регистрации этапа 3); контент рассылки — авторский, без перевода; receipts Expo не сверяются (осознанно, single-author масштаб). E2E-смоук: send(tier:oracle) → delivery под RLS → mark read → history → каскадная зачистка.
