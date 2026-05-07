---
id: 02_modules/practices/history
title: Practices History
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/product_model, 02_modules/subscription/spec, 02_modules/biofeedback/spec, 02_modules/audio/spec, 02_modules/bindu/spec]
code_refs:
  [
    modules/practices/core/catalog.ts,
    modules/mandala/experiments/SacredSymbolStreamScreen.tsx,
    app/asana-practice.tsx,
    supabase/migrations/20260429051600_calibration_dialogue_orchestrator.sql,
  ]
---

## Decision Log

- **2026-05-07:** Миграция документации по `migration_protocol.md`: канон — код. Исторические briefs из `docs/tmp_docs/02052026/` перенесены в `docs/05_archive/migrated/practices/`. Файлы **`assistant_practice_recommendation_brief.md`** (ассистент + выбор/запуск практики) и **`access_tiers_navigation_brief.md`** (тарифы, табы, в т.ч. `practice_catalog` / `asana_practices`) архивированы **как смешанные** с соседними модулями; для сценариев ассистента см. также будущую/текущую документацию `assistant`, для гейтов — `subscription`.

- **2026-05-07:** **Vimeo и экран асан.** ТЗ предполагало проигрывание ~200 видео; фактически `app/asana-practice.tsx` показывает заглушку (нет WebView в dev-client) и опирается на `video_external_id` из БД для будущего Remote Play / нативного плеера. Каталог и запись завершения сессии реализованы.

- **2026-05-07:** **Биометрия медитации.** В старых формулировках допускалась неопределённость; в коде **`SacredSymbolStreamScreen`** не используется biofeedback и в `recordPracticeSession` уходит **`metrics: {}`**. Пульсометр и расчёт итоговых метрик — только **`CoherenceBreathScreen`**.

- **2026-05-07:** **Каталог дыхания vs таблица `practices`.** Дыхательные карточки собираются из констант **`BREATH_PRACTICES`** в коде, а не из строк Supabase с `kind = 'breath'` (таблица при этом допускает `breath` по схеме init — для серверных сценариев/импорта). Йога-асаны — из БД.

- **2026-05-07:** **Дефолт длительности «Вспышка».** В `modules/practices/core/catalog.ts` для launch по умолчанию задано **3 мин** (`defaultDurationSec` / `durationMs` в карточке); в **`SacredSymbolStreamScreen`** при отсутствии пропсов используется **5 мин** (`DEFAULT_DURATION_MS`). Поведение зависит от пути входа (каталог передаёт `durationMs`, прямой диплинк — может не передавать).

- **2026-05-07:** **`user_practice_preferences`.** Триггер `practice_sessions_update_prefs` наращивает счётчик только если **`practice_id` не null**; клиент задаёт UUID **`practice_id` для асан**, для дыхания и медитации в типичном пути — нет, поэтому автоматическое ведение предпочтений по UUID для них не срабатывает.
