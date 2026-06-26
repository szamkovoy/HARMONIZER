---
id: 02_modules/infra/history
title: Infra History
version: 1.7
updated: 2026-06-27
depends_on: [01_foundation/repository_structure, 01_foundation/tech_stack]
code_refs: [_legacy_web/app/layout.tsx, _legacy_web/next.config.ts, _legacy_web/instrumentation.ts, _legacy_web/sentry.server.config.ts, _legacy_web/app/api/_utils/monitoring.ts, _legacy_web/public/manifest.json, _legacy_web/package.json, .vercelignore, package.json, sentry.client.config.ts, supabase/README.md]
---

## Decision Log

- **2026-06-27 (2):** `precompute-daily-forecasts` bundling fix: cron function no longer imports `modules/daily-engine` or `_legacy_web/*` across the repo root (Supabase remote bundler cannot resolve those paths). Morning precompute now uses `_shared/dailyForecast.ts` for `computeActivation` / aspect weights, plus Edge copies of `contentLengths`, `mathLevelI18n` (+ targets) and `contentLocales`. Deploy unblocked for paid `scenario_cache` pre-warm.

- **2026-06-27:** Supabase Edge bundler fix for shared ephemeris: `supabase/functions/_shared/dailyForecast.ts` switched `astronomia` imports from bare package paths to `https://esm.sh/astronomia@4.2.0/...`, unblocking deploy of `precompute-global-recommendations` (and any function importing the shared module). `supabase/functions/deno.json` now includes `astronomia/base`; Vitest parity aliases cover the new `base` URL.

- **2026-06-26:** LLM infra fallback contract was tightened. `_legacy_web/app/api/_utils/gemini.ts` no longer silently demotes `premium -> standard` before `AI_MODEL_FALLBACK` on interactive routes; it now tries the exact requested tier once and then falls back directly on retryable overload/timeout. In parallel, Supabase cron functions `precompute-daily-forecasts` and `precompute-global-recommendations` gained their own background retry policy: up to 3 primary-model attempts with 60-second pauses, then one fallback attempt for that generation.

- **2026-06-16:** Groq Whisper pipeline: `whisperPrompts.ts` — `LANGUAGE_ALIASES` для 8 локалей, optional `language` (omit → `AUTO_DETECT_DOMAIN_PROMPT`), `normalizeWhisperLanguage` → `string | undefined`; `whisperTranscription.ts` и `/transcribe` клиент пропускают `language` в form, когда hint не задан. Контракт STT — `communicator/spec.md`, `i18n/spec.md` §8.

- **2026-06-09 (4):** Sentry-шум от штатной перегрузки LLM и обрыва SSE снижен: `reportRouteError` логирует «Сервис временно недоступен…» как `warning` (не `error`), `sentry.server.config.ts` фильтрует `failed to pipe response`, dialog SSE при ошибке responder закрывается событием `error` + `controller.close()` вместо `controller.error()`. Аналитика перегрузок остаётся в `user_event_log`.
- **2026-06-08 (3):** Добавлена follow-up миграция `20260608170000_activate_dialog_system_v3_v6.sql`: она деактивирует старые версии `dialog_system_v3` и явно поднимает `version = 6` в `is_active = true`, чтобы новые окружения не оставались без активного daily-dialog prompt после `db push`.
- **2026-06-08 (2):** В Supabase добавлена follow-up миграция `20260608153000_allow_day_entry_source.sql`: она расширяет CHECK `public.conversations.entry_source`, добавляя значение `day`. Это синхронизирует БД с уже существующим клиентским/серверным контрактом Day tab modal и убирает `23514 conversations_entry_source_check` при создании новой беседы.
- **2026-06-08:** Native health prebuild-конфиг добавлен в Expo: зависимости `@kingstinct/react-native-healthkit`, `react-native-nitro-modules`, `react-native-health-connect`, `expo-build-properties`; `app.config.ts` включает HealthKit entitlement, Android Health Connect permissions и SDK 35/minSdk 26, а `plugins/with-native-health.js` добавляет iOS usage descriptions и Android `HealthConnectPermissionDelegate`.

- **2026-05-21:** `instrumentation.ts` при старте Node вызывает `logTestModeStartupWarning` из `testMode.ts` до загрузки Sentry — диагностика активного `TEST_MODE_FAST_INTERVALS` без влияния на клиент Expo.

- **2026-05-15:** В **`dependencies.md`** §1 (Supabase) уточнено, что строка **`dialog_system_v3`** в **`public.prompts`** поддерживается цепочкой миграций (не только `20260511161000_dialog_system_v3.sql`), со ссылкой на модуль **`assistant`** для актуальной версии. **`MAP.md`** — в точках входа **`assistant`** добавлена миграция **`20260515030000_dialog_system_v3_pack_b.sql`**.

- **2026-05-12:** Для cold-start Supabase сознательно не добавлялся high-frequency keep-warm/ping job. Текущий приоритет зафиксирован как `cache-first + precompute + timeouts`: локальный кэш натала, частичный кэш дня, hourly global precompute, timebox на `global-content` и `fetchProfile`. Если после этого холодные задержки останутся заметными, keep-warm рассматривается как операционная мера поверх уже ускоренного контура, а не как базовая архитектура.

- **2026-05-12:** Контур free precompute для `global_daily_content` доведён до самостоятельного infra-path: `precompute-global-recommendations` теперь поддерживает rolling window `yesterday/today/tomorrow`, а новая SQL-миграция переводит invoke `public.invoke_precompute_global_recommendations()` на ежечасный cron вместо разового полуночного запуска. Параллельно `supabase/config.toml`, `supabase/README.md` и `DEPLOY.md` синхронизированы с этим сценарием как с поддерживаемым серверным контуром.

- **2026-05-11:** Infra-контракт для dialog v3 обновлён: Gemini env сведены к `AI_MODEL_STANDARD`, `AI_MODEL_PREMIUM`, единому `AI_MODEL_FALLBACK` и `MAX_DIALOG_LENGTH`; soft-cap env удалены. В `supabase/migrations` добавлен `20260511161000_dialog_system_v3.sql`, а в `_legacy_web/app/api/_utils/gemini.ts` появился explicit context caching с in-memory TTL map как временным storage cache names между вызовами одного инстанса.
- **2026-05-09:** В **`docs/02_modules/infra/spec.md`** задокументированы серверные переменные **`AI_MODEL_*`** и **`AI_MODEL_*_FALLBACK`** для Gemini на Vercel (реализация в **`_legacy_web/app/api/_utils/gemini.ts`**).

- **2026-05:** Зафиксирована миграция документации модуля `infra` по коду и плану `_proposal.md`. Исторические патчи PATCH_5 (RLS) и PATCH_11 (Whisper) перенесены в `docs/05_archive/migrated/infra/`; содержательные решения ниже сверены с репозиторием, а не с текстом патчей «как ТЗ».

- **Не датировано (реализовано в коде):** Сужение RLS для кешей натала/прогноза и защита содержимого `ai_state_proposals` воплощены миграцией `supabase/migrations/20260429180000_rls_tighten_natal_forecasts_proposals.sql`, что соответствует намерению `PATCH_5_RLS_tightening.md`. Канон — SQL-файл и фактические политики в БД.

- **Не датировано (частичное расхождение с PATCH_11):** Патч требовал отдельный UI confidence & кастомный 16 kHz preset на клиенте. В коде на сервере уже есть `getDomainPrompt`, `normalizeWhisperLanguage`, `temperature: "0"`, `response_format: "verbose_json"` и расчёт `confidence` в `_legacy_web/app/api/_utils/whisperTranscription.ts` с тестами `whisperPrompts.test.ts`. Потребительский UX «редактирование при низкой уверенности» и отдельный `WHISPER_OPTIMIZED_PRESET` в патче как единый эталон **не подтверждены** полнотой по всему `modules/communicator` — детали относятся к будущей миграции `communicator`, не к инфраструктурному минимуму.

- **Не датировано:** В корне есть `sentry.client.config.ts` (`@sentry/react-native`) и зависимость в `package.json`, но поиск по `app/*.tsx` не показывает импорта этого файла в entry. Документ `error_tracking.md` описывает оба контура; до явного подключения в корневом layout инициализация RN-Sentry считается **подготовленной, а не гарантированно активной** в рантайме.

- **Не датировано (док ↔ продукт):** `docs/tech_stack.md` заявляет, что PWA/manifest не являются целевой платформой, при этом `_legacy_web/app/layout.tsx` продолжает отдавать `manifest`, иконки и `appleWebApp`. Это осознанный остаточный web-shell для API и опциональной установки страницы, а не противоречие в коде — приоритет продукта на стороне Expo.

- **Не датировано:** `.vercelignore` исключает `/supabase` из upload при деплое из корня; операции с миграциями выполняются через Supabase CLI локально/в CI, а не через артефакт Vercel — это снижает размер билда и отделяет жизненный цикл БД от Next bundle.
