---
id: 02_modules/infra/spec
title: Infra Spec
version: 1.7
updated: 2026-06-27
depends_on: [01_foundation/repository_structure, 01_foundation/tech_stack]
code_refs: [_legacy_web/app/layout.tsx, _legacy_web/next.config.ts, _legacy_web/instrumentation.ts, _legacy_web/sentry.server.config.ts, _legacy_web/app/api/_utils/monitoring.ts, _legacy_web/public/manifest.json, _legacy_web/package.json, .vercelignore, package.json, sentry.client.config.ts, supabase/README.md]
---

## 1. Назначение

Модуль `infra` описывает техническое основание репозитория: Next.js web-shell и API в `_legacy_web/`, границы загрузки на Vercel, корневой Expo-клиент, схему Supabase и серверный контур наблюдаемости. Это не продуктовый домен: здесь фиксируется то, на чём строятся остальные модули (деплой, окружения, PWA-остаток, error tracking, миграции БД).

## 2. Публичный контракт

Публичность — в смысле «что может импортировать или настраивать соседний слой», а не npm-пакет.

**Next.js (`_legacy_web/`)**

- `RootLayout` (`_legacy_web/app/layout.tsx`) — HTML-оболочка API-сервиса: `metadata` (title, `manifest`, иконки, `appleWebApp`), `viewport` (theme-color, масштаб), `lang="en"` для документа.
- `nextConfig` (`_legacy_web/next.config.ts`) — `outputFileTracingRoot` указывает на корень `_legacy_web`; экспорт обёрнут в `withSentryConfig` (орг/проект Sentry, `tunnelRoute: "/monitoring"`, `disableLogger`, `widenClientFileUpload`).
- `register()` (`_legacy_web/instrumentation.ts`) — при `NEXT_RUNTIME === "nodejs"` импортирует `logTestModeStartupWarning` из `app/api/_utils/testMode.ts` (однократный `console.warn` при `TEST_MODE_FAST_INTERVALS=1`), затем подгружает `sentry.server.config`.
- `Sentry.init` (`_legacy_web/sentry.server.config.ts`) — серверный SDK: `dsn` из `SENTRY_DSN`, `enabled` при наличии DSN, `environment` из `VERCEL_ENV` / `NODE_ENV`, `tracesSampleRate` из `SENTRY_TRACES_SAMPLE_RATE` (дефолт `0.05`); `beforeSend` отбрасывает `failed to pipe response` и связанные с expected LLM-unavailable артефакты SSE.
- `onRequestError` — экспорт `Sentry.captureRequestError` из `instrumentation.ts` для Next error boundary.
- `reportRouteError(error, context)` (`_legacy_web/app/api/_utils/monitoring.ts`) — обогащает scope Sentry тегами (`endpoint`, `stage`, `timeout`, `llm_error`, `http_status`, `expected_llm_unavailable`), вызывает `Sentry.captureException` (или `captureMessage` уровня `warning` для штатного user-facing «Сервис временно недоступен…» после исчерпания LLM fallback), параллельно пишет строки в `user_event_log` через `logUserEvent` (виды `api_error`, `llm_error`, `llm_timeout`).
- `logUserEvent`, `isTimeoutError`, `isLlmError`, `isExpectedLlmUnavailableError`, `isStreamPipeArtifactError`, `toUserFacingStreamErrorMessage` — вспомогательные функции того же файла для маршрутов API.

**Корень монорепозитория**

- `package.json` — Expo SDK 54, скрипты `expo start` / dev-client / EAS, `vitest run`, зависимости клиента включая `@sentry/react-native`, `@kingstinct/react-native-healthkit`, `react-native-nitro-modules`, `react-native-health-connect`, `@sfourdrinier/react-native-ble-plx` и `expo-build-properties` для native health / BLE provider.
- `app.config.ts` + `plugins/with-native-health.js` — prebuild-конфиг для Apple HealthKit, Android Health Connect и BLE heart-rate monitors: iOS добавляет HealthKit entitlement, usage descriptions и `NSBluetoothAlwaysUsageDescription`; Android добавляет `android.permission.health.READ_*`, `BLUETOOTH(_SCAN/_CONNECT)`, `HealthConnectPermissionDelegate` в `MainActivity` и SDK 35 / minSdk 26 через `expo-build-properties`. BLE работает только в dev-client / prebuild build, не в Expo Go.
- `sentry.client.config.ts` — `Sentry.init` для React Native: `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (дефолт выборки `0.05`). Файл лежит в корне; факт подключения к entry-point приложения нужно сверять с текущим `app/` (см. `history.md`).

**Vercel**

- `.vercelignore` — исключает из CLI-upload корня тяжёлые деревья (`/android`, `/ios`, `/app`, большая часть `/modules/*`, `/docs`, `/supabase` и т.д.), оставляя для сервера доступ к `_legacy_web` и явно к `modules/practices/**` для общих импортов API.

**Supabase**

- `supabase/README.md` — операционный контракт папки: структура `migrations/`, `functions/`, `seed.sql`, требования к `.env.local` для CLI, команды `link` / `db push`, cron-функции (`auto-calibrate`, `precompute-daily-forecasts`, `precompute-global-recommendations`, `cleanup-expired-proposals`), правило «не править старые миграции — только новые файлы».
- `supabase/config.toml` — локальные флаги edge-функций; для cron-style вызовов `verify_jwt = false` фиксируется и для `precompute-global-recommendations`.
- `DEPLOY.md` — чеклист серверного/edge-деплоя, включая список функций, секрет `CRON_SECRET` и рекомендуемые расписания.

**PWA-остаток**

- `_legacy_web/public/manifest.json` + ссылки из `layout` — ярлык/installability для web-shell; продуктовый клиент — Expo (см. `pwa.md`).

## 3. Внутренняя архитектура

- **Два рантайма клиента:** основной — React Native (Expo) из корня; вторичный — Next App Router в `_legacy_web` как хост API и лёгкой статической оболочки.
- **Сборка API:** Next компилирует маршруты `app/api/*`; общая логика практик может тянуть типы/данные из `modules/practices/**`, что отражено в `.vercelignore`.
- **Наблюдаемость:** серверная цепочка Sentry стартует из instrumentation → `sentry.server.config`; ошибки маршрутов централизованно пробрасываются в Sentry и в Supabase `user_event_log` через `monitoring.ts`.
- **Данные:** версионируемая схема и edge-функции живут в `supabase/`; продакшен-изменения проходят через новые SQL-миграции, как зафиксировано в README.
- **Cron-контур free day content:** global free-прогноз подогревается отдельной edge-функцией `precompute-global-recommendations`; расписание хранится вне клиента и может дублироваться как pg_cron invoke + Scheduled Functions runbook, но канон по коду — новые миграции и `DEPLOY.md`. Для LLM в cron/precompute-контуре действует отдельная background policy: целевая primary-модель (`AI_MODEL_STANDARD` или `AI_MODEL_PREMIUM` по `prompt.model_hint`) пробуется до 3 раз подряд с паузой 60s, и только затем один раз используется `AI_MODEL_FALLBACK`.

## 4. Конфигурация и параметры

| Область | Параметр | Где задаётся |
| --- | --- | --- |
| Сервер Sentry | `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `VERCEL_ENV` | Vercel env + `sentry.server.config.ts` |
| Клиент Sentry (RN) | `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_APP_ENV`, `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Expo env + `sentry.client.config.ts` |
| Next bundle tracing | `outputFileTracingRoot` | `_legacy_web/next.config.ts` |
| Sentry build plugin | `org`, `project`, `tunnelRoute: "/monitoring"` | `withSentryConfig` в `next.config.ts` |
| Web manifest | `name`, `icons`, `theme_color`, `display` | `_legacy_web/public/manifest.json` |
| Supabase CLI | `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, секреты функций | локально `.env.local`; в облаке — Dashboard / secrets |
| Supabase cron / Edge | `CRON_SECRET`, `verify_jwt = false` для cron-функций, расписание `precompute-global-recommendations` | `DEPLOY.md`, `supabase/config.toml`, SQL-миграции `pg_cron_*` |
| Groq Whisper (связанный pipeline) | `GROQ_API_KEY`, optional `language` (8 aliases via `LANGUAGE_ALIASES`; omitted → auto-detect + multilingual domain prompt), `temperature: 0`, `verbose_json` | `_legacy_web/app/api/_utils/whisperTranscription.ts`, `whisperPrompts.ts` |
| Gemini (Vercel API) | `GEMINI_API_KEY`, `AI_MODEL_STANDARD`, `AI_MODEL_PREMIUM`, `AI_MODEL_FALLBACK`, `MAX_DIALOG_LENGTH`, опционально `GEMINI_TIMEOUT_MS`, `ALLOW_LEGACY_GEMINI_MODELS` | Vercel env + `_legacy_web/app/api/_utils/gemini.ts`, `_legacy_web/app/api/_utils/dialogConfig.ts`; interactive paths use `requested tier -> fallback`, cron/precompute retries the requested tier 3x before fallback |
| Native health | iOS HealthKit entitlement / usage descriptions; Android Health Connect `READ_STEPS`, `READ_ACTIVE_CALORIES_BURNED`, `READ_EXERCISE`, `READ_SLEEP`, minSdk 26, compile/target SDK 35 | `app.config.ts`, `plugins/with-native-health.js`, `services/nativeHealth.ts` |
| BLE chest straps | iOS `NSBluetoothAlwaysUsageDescription`; Android `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`; Expo config plugin `@sfourdrinier/react-native-ble-plx`; dev-client/prebuild only | `app.config.ts`, `package.json`, `modules/biofeedback/wearables/*` |

Корневой `package.json` не описывает Next-скрипты: они живут в `_legacy_web/package.json` (`next dev`, `next build`, `next lint`).

## 5. Известные ограничения

- **PWA vs мобильный клиент:** manifest и apple-web-app метаданные остаются в `_legacy_web`, но целевой UX — Expo; web-shell не выравнивается по функциональности с приложением.
- **`.vercelignore`:** часть корневых деревьев намеренно не попадает в upload; любой новый импорт из «игнорируемого» пути в API сломает деплой до правки ignore-листа.
- **Документ `docs/tech_stack.md`:** утверждает вторичность PWA — это согласовано с ролью `_legacy_web`, но сам layout всё ещё экспонирует manifest/icons как для installable web; противоречие только в продуктовом приоритете, не в наличии файлов.
- **React Native Sentry:** зависимость и `sentry.client.config.ts` есть; без явного импорта в entry инициализация может не выполняться — зафиксировано в `history.md`.
- **Dialog cache storage:** explicit Gemini context caching пока держится в in-memory TTL map внутри `gemini.ts`; между cold start / инстансами Vercel cache name не разделяется, поэтому это оптимизация best-effort, а не гарантированная распределённая кеш-инфраструктура.
