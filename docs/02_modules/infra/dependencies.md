---
id: 02_modules/infra/dependencies
title: Infra Dependencies
version: 1.5
updated: 2026-06-16
depends_on: [01_foundation/repository_structure, 01_foundation/tech_stack]
code_refs: [_legacy_web/app/layout.tsx, _legacy_web/next.config.ts, _legacy_web/instrumentation.ts, _legacy_web/sentry.server.config.ts, _legacy_web/app/api/_utils/monitoring.ts, _legacy_web/public/manifest.json, _legacy_web/package.json, .vercelignore, package.json, sentry.client.config.ts, supabase/README.md]
---

## 1. Зависит от

- **`01_foundation/*` (документы)**  
  Канонические описания репозитория, стека и интеграций задают терминологию и ожидаемые переменные окружения; `infra` не дублирует их содержание, но опирается на них при описании деплоя и границ клиент/сервер.

- **Vercel / Node runtime**  
  `_legacy_web/next.config.ts` и `instrumentation.ts` предполагают развёртывание Next на Vercel (или совместимом хосте) с поддержкой `instrumentation` hook и env `VERCEL_ENV`. Для dialog v3 сервер также опирается на поведение инстанса Node-процесса, потому что explicit Gemini cache names временно хранятся в памяти процесса.

- **Sentry (SaaS)**  
  `withSentryConfig`, `sentry.server.config.ts` и `monitoring.ts` используют DSN и параметры проекта `harmonizer-backend` (орг в конфиге Next). Без `SENTRY_DSN` серверный SDK отключён (`enabled: false`), но обёртка сборки остаётся.

- **Supabase**  
  `reportRouteError` / `logUserEvent` принимают `SupabaseClient`; запись в `user_event_log` требует рабочей схемы и RLS, описанных в миграциях. Edge Functions и cron из `supabase/README.md` зависят от облачных секретов. Таблица `public.prompts` получает и обновляет runtime prompt **`dialog_system_v3`** цепочкой миграций, начиная с `20260511161000_dialog_system_v3.sql` и далее пакетами «А»/«B» (активная версия и archived v7 prompts — в модуле **`assistant`**, см. `docs/02_modules/assistant/spec.md` и `docs/05_archive/migrated/assistant/dialog_v7_prompts-reference.md`).

- **Groq API**  
  Косвенно: инфраструктура API включает маршруты транскрипции, использующие `GROQ_API_KEY` и общий util `whisperTranscription.ts` / `whisperPrompts.ts` (optional `language` с 8 aliases или auto-detect, domain prompt, verbose_json). Это граница с модулем `communicator`, но env и лимиты провайдера — инфраструктурный контракт сервера.

## 2. От него зависят

- **`astro`**  
  Использует HTTP API под `_legacy_web/app/api/astro/*` и edge `supabase/functions/daily-forecast`; деплой и env Vercel/Supabase задаются инфраструктурой.

- **`calibration`**  
  Маршруты `_legacy_web/app/api/calibration/*`, `supabase/functions/auto-calibrate`; требуют сервисных ключей и защищённых миграций (в т.ч. RLS).

- **`profile`**, **`daily_forecast`**, **`assistant`**, **`communicator`**, **`practices`**, **`bindu`**, **`audio`**, **`biofeedback`**, **`subscription`**  
  Читают `EXPO_PUBLIC_*` URL/ключи, ходят на задеплоенный Next API, используют Supabase клиент схемы из `supabase/migrations`. Для daily dialog v3 особенно критичны серверные env `AI_MODEL_STANDARD`, `AI_MODEL_PREMIUM`, `AI_MODEL_FALLBACK`, `MAX_DIALOG_LENGTH` и наличие prompt `dialog_system_v3`; любое изменение `.vercelignore`, корневых путей трейсинга или базового URL API затрагивает всех потребителей.

- **`webinars`**, **`author_presence` (planned)**  
  В `MAP.md` помечены как зависящие от `infra` и `subscription` по плану продукта; отдельного кода под них в инфраструктурных entry points нет.

## 3. Контрактные точки риска

- **Сигнатура и поведение `reportRouteError`** — все вызовы из API-роутов завязаны на shape `RouteErrorContext` (`endpoint`, `stage`, `userId`, `payload`); изменение тегов Sentry или полей `user_event_log` ломает аналитику и алерты.
- **`outputFileTracingRoot`** — должен указывать на `_legacy_web`; смещение ломает Vercel file tracing (правило в `.cursor/rules/vercel-deploy.mdc`).
- **`.vercelignore` список `/modules/*`** — сейчас явно разрешён импорт из `modules/practices/**`; добавление API-импорта из другого поддерева `modules/` без правки ignore даёт «модуль не найден» на сервере.
- **`SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN`** — разные ключи для сервера и клиента; перепутывание префиксов даёт молчаливое отключение (`enabled: false`).
- **RLS и миграции** — сужение политик (как в `20260429180000_rls_tighten_natal_forecasts_proposals.sql`) требует синхронного перевода всех write-путей на `service_role`; иначе API начнёт получать `42501` от PostgREST.
- **`tunnelRoute: "/monitoring"`** — конфликт с собственным маршрутом приложения по тому же пути сломает туннель Sentry.
- **Gemini env rename** — legacy `AI_MODEL_STANDARD_FALLBACK` / `AI_MODEL_PREMIUM_FALLBACK` удалены; если Vercel/локальное окружение не синхронизировано на единый `AI_MODEL_FALLBACK`, dialog-маршруты будут падать ещё до обращения к модели.
