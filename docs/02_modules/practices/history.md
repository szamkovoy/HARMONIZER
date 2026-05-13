---
id: 02_modules/practices/history
title: Practices History
version: 1.3
updated: 2026-05-14
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

- **2026-05-14:** Документирован контракт сервера: в **`practiceSelection.ts`** для не-`default` **`[PRACTICE_PICK]`** сначала резолвится **`id` / `slug`** по полному активному каталогу — карточка в приложении совпадает с выбором премиум-модели. **`spec.md`** (§2 интеграция с ассистентом).
- **2026-05-11:** `modules/practices/ui/PracticeCard.tsx` стал единым компонентом для каталога и коммуникатора. Assistant-launch больше не идёт через отдельный `launchPracticeFromAssistant` на home: `Communicator.tsx` сам адаптирует `PracticePicked` в `PracticeSummary`, даёт пользователю override duration/chakra и вызывает `launchPractice(..., { launchSource: 'assistant' })`. На сервере default assistant marker теперь явно резолвится в coherent breathing 10 мин на чакру дня.
- **2026-05-08 (второй проход):** **`PracticeCatalogScreen` + отложенная йога.** (1) Колбэк мог отработать **раньше** продолжения `load()` — сброс **`yogaLateLoading`** и перезапись **`setState`** пустым `yoga` из возврата каталога. (2) Чаще наоборот: продолжение **`load()`** шло **раньше** микрозадачи с **`onLateYogaPractices`**, слот **`lateYogaSlotRef`** оставался пустым → в UI «нет асан» при живых данных. Исправления: слот **`lateYogaSlotRef`**, **`mergedYoga`**, **`yogaLateLoading`** до ожидания, после **`await loadPracticeCatalog`** — **`await Promise.resolve()`**, чтобы слисть очередь микрозадач перед чтением слота. (3) При **медленном** Supabase колбэк мог прийти, пока экран ещё в **`loading`**: ранний **`return current`** в **`setState`** отбрасывал асаны, затем основной поток фиксировал **`ready`** с пустой йогой. Сейчас: **`catalogMeditationBreathRef`** + **`pendingLateYogaRef`**, колбэк всегда собирает **`{ meditation, breath, yoga }`** из ref среза (или откладывает до записи среза). Код: `modules/practices/ui/PracticeCatalogScreen.tsx`.

- **2026-05-08:** **`loadPracticeCatalog` + `onLateYogaPractices`.** Ранее колбэк вешался на «сырой» промис йоги без таймаута и без вызова при `reject` — экран «Практики» мог бесконечно показывать отложенную загрузку асан. Сейчас для этой ветки используется тот же **`withTimeout` (12 с)**, ошибка мапится в пустой список, при срабатывании таймаута после фактического ответа возможен второй вызов колбэка с данными. Код: `modules/practices/core/catalog.ts`.

- **2026-05-07:** Миграция документации по `migration_protocol.md`: канон — код. Исторические briefs из `docs/tmp_docs/02052026/` перенесены в `docs/05_archive/migrated/practices/`. Файлы **`assistant_practice_recommendation_brief.md`** (ассистент + выбор/запуск практики) и **`access_tiers_navigation_brief.md`** (тарифы, табы, в т.ч. `practice_catalog` / `asana_practices`) архивированы **как смешанные** с соседними модулями; для сценариев ассистента см. также будущую/текущую документацию `assistant`, для гейтов — `subscription`.

- **2026-05-07:** **Vimeo и экран асан.** ТЗ предполагало проигрывание ~200 видео; фактически `app/asana-practice.tsx` показывает заглушку (нет WebView в dev-client) и опирается на `video_external_id` из БД для будущего Remote Play / нативного плеера. Каталог и запись завершения сессии реализованы.

- **2026-05-07:** **Биометрия медитации.** В старых формулировках допускалась неопределённость; в коде **`SacredSymbolStreamScreen`** не используется biofeedback и в `recordPracticeSession` уходит **`metrics: {}`**. Пульсометр и расчёт итоговых метрик — только **`CoherenceBreathScreen`**.

- **2026-05-07:** **Каталог дыхания vs таблица `practices`.** Дыхательные карточки собираются из констант **`BREATH_PRACTICES`** в коде, а не из строк Supabase с `kind = 'breath'` (таблица при этом допускает `breath` по схеме init — для серверных сценариев/импорта). Йога-асаны — из БД.

- **2026-05-07:** **Дефолт длительности «Вспышка».** В `modules/practices/core/catalog.ts` для launch по умолчанию задано **3 мин** (`defaultDurationSec` / `durationMs` в карточке); в **`SacredSymbolStreamScreen`** при отсутствии пропсов используется **5 мин** (`DEFAULT_DURATION_MS`). Поведение зависит от пути входа (каталог передаёт `durationMs`, прямой диплинк — может не передавать).

- **2026-05-07:** **`user_practice_preferences`.** Триггер `practice_sessions_update_prefs` наращивает счётчик только если **`practice_id` не null**; клиент задаёт UUID **`practice_id` для асан**, для дыхания и медитации в типичном пути — нет, поэтому автоматическое ведение предпочтений по UUID для них не срабатывает.
