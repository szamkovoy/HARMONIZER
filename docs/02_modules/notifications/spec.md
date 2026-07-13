---
id: 02_modules/notifications/spec
title: Notifications Spec
version: 1.0
updated: 2026-07-08
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
    _legacy_web/app/api/admin/notifications/expoPush.ts,
    _legacy_web/app/api/admin/notifications/segment.ts,
    services/localNotifications.ts,
    supabase/migrations/20260423080000_init.sql,
    supabase/migrations/20260708150000_notifications.sql,
  ]
---

## 1. Назначение (продукт)

Рассылки владельца сегментам пользователей: push через Expo **плюс гарантированная копия** в списке «Мои уведомления» в Профиле — сообщение (например, ссылка на запись вебинара) доходит и при выключенных push-разрешениях. Этап 4 плана админ-панели.

## 2. Публичный контракт

**Клиент (`modules/notifications`, barrel `index.ts`):**

- **`PushRegistrationBridge`** — невидимый мост в корне (`app/_layout.tsx`, внутри AccessBridge): после логина один раз за сессию вызывает `registerPushToken(userId)`; слушает тапы по push (`addNotificationResponseReceivedListener`) и открывает `data.url` через `Linking`.
- **`registerPushToken(userId)`** — permissions (`undetermined` → request; не granted → тихий выход), `getExpoPushTokenAsync({projectId})` (EAS projectId из `app.json` extra), upsert в `push_tokens` по `token` (`is_active: true`, `last_seen_at`). Web/старый dev client — no-op.
- **`MyNotificationsScreen`** (`app/my-notifications.tsx`) — список доставок (заголовок, текст, относительное время через `formatRelativeTime`, кнопка «Открыть ссылку»); непрочитанные подсвечены акцентной рамкой; открытие экрана помечает всё прочитанным (`markAllNotificationsRead`).
- **Профиль** — карточка «Мои уведомления» с бейджем непрочитанных (`fetchUnreadNotificationCount` на фокусе) → `/my-notifications`.

**Админка (гейт `requireAdmin`):**

- `GET /api/admin/notifications` — история рассылок (≤100, счётчики).
- `POST /api/admin/notifications` — `{title, body?, link_url?, segment}`; сегменты: `all`, `tier:<free|oracle|practitioner|master>` (по сырому `users.membership_tier`), `webinar:<id>` (записавшиеся). Поток: resolve получателей → строка `notifications` → `notification_deliveries` пачками по 500 → Expo Push (`expoPush.ts`, пачки по 100, `data.url` из `link_url`) → деактивация `DeviceNotRegistered`-токенов → апдейт счётчиков + `sent_at`. `maxDuration = 120`.
- UI `/admin/notifications`: форма (заголовок, текст, ссылка, select сегмента с тарифами и вебинарами) + история с сегментом и счётчиками.

## 3. Данные

- **`push_tokens`** — из init-миграции (id pk, `token` unique, `platform`, `expo_token`, `is_active`, `last_seen_at`; RLS self). Клиент начал писать в неё с этого этапа; рассылка берёт только `is_active`.
- **`notifications`** (`20260708150000`): `title`, `body`, `link_url`, `segment` (машинный), `segment_label` (человекочитаемый для истории), `recipient_count/push_sent_count/push_error_count`, `sent_at`. RLS: получатель читает только доставленные ему (exists в deliveries), admin all.
- **`notification_deliveries`** — PK `(notification_id, user_id)`, `read_at`; FK cascade. RLS: select own, **update own** (отметка прочтения), admin all. Индекс `(user_id, created_at desc)`.

## 4. i18n

UI-строки — ключи `notifications.*` (8 локалей). **Контент рассылки — авторский** (как посты/сторис): отправляется на языке автора, не переводится. `segment_label` — RU-строка для админки, пользователю не показывается.

## 5. Известные ограничения

- Рассылка синхронная в serverless-роуте: при тысячах получателей упрётся в `maxDuration` — тогда выносить в очередь/Edge cron.
- Пуш не «догоняет» пользователей, зарегистрировавших токен после рассылки; копия в «Мои уведомления» это компенсирует.
- Тикеты Expo не сверяются с receipts (fire-and-forget); `push_error_count` учитывает только ошибки тикетов.
