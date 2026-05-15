---
id: 02_modules/infra/history
title: Infra History
version: 1.5
updated: 2026-05-15
depends_on: [01_foundation/repository_structure, 01_foundation/tech_stack]
code_refs: [_legacy_web/app/layout.tsx, _legacy_web/next.config.ts, _legacy_web/instrumentation.ts, _legacy_web/sentry.server.config.ts, _legacy_web/app/api/_utils/monitoring.ts, _legacy_web/public/manifest.json, _legacy_web/package.json, .vercelignore, package.json, sentry.client.config.ts, supabase/README.md]
---

## Decision Log

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
