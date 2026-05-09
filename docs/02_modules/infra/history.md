---
id: 02_modules/infra/history
title: Infra History
version: 1.2
updated: 2026-05-09
depends_on: [01_foundation/repository_structure, 01_foundation/tech_stack]
code_refs: [_legacy_web/app/layout.tsx, _legacy_web/next.config.ts, _legacy_web/instrumentation.ts, _legacy_web/sentry.server.config.ts, _legacy_web/app/api/_utils/monitoring.ts, _legacy_web/public/manifest.json, _legacy_web/package.json, .vercelignore, package.json, sentry.client.config.ts, supabase/README.md]
---

## Decision Log

- **2026-05-09:** В **`docs/02_modules/infra/spec.md`** задокументированы серверные переменные **`AI_MODEL_*`** и **`AI_MODEL_*_FALLBACK`** для Gemini на Vercel (реализация в **`_legacy_web/app/api/_utils/gemini.ts`**).

- **2026-05:** Зафиксирована миграция документации модуля `infra` по коду и плану `_proposal.md`. Исторические патчи PATCH_5 (RLS) и PATCH_11 (Whisper) перенесены в `docs/05_archive/migrated/infra/`; содержательные решения ниже сверены с репозиторием, а не с текстом патчей «как ТЗ».

- **Не датировано (реализовано в коде):** Сужение RLS для кешей натала/прогноза и защита содержимого `ai_state_proposals` воплощены миграцией `supabase/migrations/20260429180000_rls_tighten_natal_forecasts_proposals.sql`, что соответствует намерению `PATCH_5_RLS_tightening.md`. Канон — SQL-файл и фактические политики в БД.

- **Не датировано (частичное расхождение с PATCH_11):** Патч требовал отдельный UI confidence & кастомный 16 kHz preset на клиенте. В коде на сервере уже есть `getDomainPrompt`, `normalizeWhisperLanguage`, `temperature: "0"`, `response_format: "verbose_json"` и расчёт `confidence` в `_legacy_web/app/api/_utils/whisperTranscription.ts` с тестами `whisperPrompts.test.ts`. Потребительский UX «редактирование при низкой уверенности» и отдельный `WHISPER_OPTIMIZED_PRESET` в патче как единый эталон **не подтверждены** полнотой по всему `modules/communicator` — детали относятся к будущей миграции `communicator`, не к инфраструктурному минимуму.

- **Не датировано:** В корне есть `sentry.client.config.ts` (`@sentry/react-native`) и зависимость в `package.json`, но поиск по `app/*.tsx` не показывает импорта этого файла в entry. Документ `error_tracking.md` описывает оба контура; до явного подключения в корневом layout инициализация RN-Sentry считается **подготовленной, а не гарантированно активной** в рантайме.

- **Не датировано (док ↔ продукт):** `docs/tech_stack.md` заявляет, что PWA/manifest не являются целевой платформой, при этом `_legacy_web/app/layout.tsx` продолжает отдавать `manifest`, иконки и `appleWebApp`. Это осознанный остаточный web-shell для API и опциональной установки страницы, а не противоречие в коде — приоритет продукта на стороне Expo.

- **Не датировано:** `.vercelignore` исключает `/supabase` из upload при деплое из корня; операции с миграциями выполняются через Supabase CLI локально/в CI, а не через артефакт Vercel — это снижает размер билда и отделяет жизненный цикл БД от Next bundle.
