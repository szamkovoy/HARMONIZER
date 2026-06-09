---
id: 02_modules/infra/error_tracking
title: Infra Error Tracking
version: 1.2
updated: 2026-06-09
depends_on: [02_modules/infra/spec]
code_refs: [_legacy_web/next.config.ts, _legacy_web/instrumentation.ts, _legacy_web/sentry.server.config.ts, _legacy_web/app/api/_utils/monitoring.ts, sentry.client.config.ts, package.json, _legacy_web/package.json]
---

## 1. Next.js / сервер API

- **`@sentry/nextjs`** подключён в `_legacy_web/package.json` и оборачивает конфиг через `withSentryConfig` (`org`, `project: harmonizer-backend`, `tunnelRoute: "/monitoring"`, `silent` вне CI, `widenClientFileUpload`, `disableLogger`).
- **`instrumentation.ts`** при `NEXT_RUNTIME === "nodejs"` динамически импортирует `sentry.server.config.ts`.
- **`sentry.server.config.ts`** — `Sentry.init` с `dsn: process.env.SENTRY_DSN`, `enabled` только если DSN задан, `environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV`, `tracesSampleRate` из `SENTRY_TRACES_SAMPLE_RATE` (число, по умолчанию `0.05`); `beforeSend` через `isStreamPipeArtifactError` / `isExpectedLlmUnavailableError` отбрасывает `failed to pipe response` и связанные артефакты обрыва SSE.
- **`onRequestError`** экспортируется как `Sentry.captureRequestError` для интеграции с обработкой ошибок Next.
- **`reportRouteError`** в `app/api/_utils/monitoring.ts` — основной путь: `captureException` с тегами `endpoint`, `stage`, `timeout`, `llm_error`, `http_status` и контекстом payload; для штатного user-facing «Сервис временно недоступен…» / «Service is temporarily busy…» — `captureMessage` уровня `warning` с тегом `expected_llm_unavailable` (без `captureException`); дублирование в Supabase `user_event_log` через `logUserEvent`. Вспомогательные экспорты: `isExpectedLlmUnavailableError`, `isStreamPipeArtifactError`, `toUserFacingStreamErrorMessage`.

## 2. React Native (клиент)

- В корневом `package.json` есть **`@sentry/react-native`**.
- **`sentry.client.config.ts`** в корне репозитория вызывает `Sentry.init` с `EXPO_PUBLIC_SENTRY_DSN`, `environment` из `EXPO_PUBLIC_APP_ENV` / `NODE_ENV`, `tracesSampleRate` из `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (дефолт `0.05`).
- Явного импорта этого файла из `app/` в текущем дереве не найдено — см. расхождение в `history.md`. Для продакшен-сбора нужно подтвердить wiring (например через `app/_layout.tsx` или конфиг Metro/Expo), иначе события клиента не попадут в Sentry.

## 3. Переменные окружения (кратко)

| Слой | Переменные |
| --- | --- |
| Сервер Next | `SENTRY_DSN`, опционально `SENTRY_TRACES_SAMPLE_RATE` |
| Expo | `EXPO_PUBLIC_SENTRY_DSN`, опционально `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` |

## 4. Ограничения

- Клиентский и серверный DSN/проекты могут различаться; это два независимых контура инициализации.
- `user_event_log` заполняется best-effort: ошибка insert логируется в `console.warn`, но не пробрасывается пользователю.
