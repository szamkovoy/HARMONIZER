---
id: 02_modules/assistant/history
title: Assistant History
version: 1.3
updated: 2026-05-09
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/practices/spec, 02_modules/subscription/spec]
code_refs: [_legacy_web/app/api/communicator/v2/dialog/route.ts, supabase/migrations/20260501173500_scenarios_architecture.sql, supabase/migrations/20260501185700_monologue_prompts_v2.sql, supabase/migrations/20260509120000_dialog_quality_v4.sql]
---

## Decision Log

- **2026-05-09:** Добавлены утилиты **`explicitSignals.ts`** / **`softCap.ts`**; в **`communicator/v2/dialog`** интегрированы **`detectExplicitSignals`** (подстановка **`explicit_signals_json`** в оркестратор), **`getSoftCap`** в payload осей и в промпт, метрики ходов для оркестратора и бюджетов астрологии/чакр, расширенный рендер **`responder_main`**. В **`orchestrator.ts`**: поле **`user_register`**, расширенные **`responder_hints`**, нормализация подсказок из сырого JSON. Миграция **`20260509120000_dialog_quality_v4.sql`** — новые активные версии **`responder_main`**, **`orchestrator_decision`**, **`phase_collect_state`**, **`phase_deepen_inquiry`**, **`phase_offer_insight`**, **`phase_contextual_greeting`**.

- **2026-05-08:** В **`/api/communicator/v2/dialog`** для стрима ответа респондера задан нижний предел **`maxOutputTokens` = 2048** (поверх значения из `prompts`), чтобы реже обрывать длинные реплики по лимиту вывода модели.

- **2026-05-08:** В **`_legacy_web/app/api/_utils/gemini.ts`** для **`gemini-2.5*`** в `generationConfig` передаётся **`thinkingConfig: { thinkingBudget: 0 }`**, чтобы внутренний thinking не съедал бюджет **`maxOutputTokens`** и не обрывал видимый текст посреди фразы. Для **`gemini-3*`** отдельный `thinkingConfig` не задаётся — сохраняется глубина рассуждений по умолчанию API.

- **2026-05:** Зафиксирован канон кода: таблица **`scenarios`** и **`scenario_cache`** применены (миграция `20260501173500_scenarios_architecture.sql`); точки входа **`/api/ai/monologue`** и **`/api/ai/dialog`** (реэкспорт на общий обработчик диалога) — целевая унификация PATCH 12; параллельно сохранён **`/api/communicator/v2/dialog`** для клиентов без `scenario_id`. Исторические тексты PATCH 12 перенесены в `docs/05_archive/migrated/assistant/`.

- **2026-05:** Расхождение с линейным описанием MODULE_4 «калибровка только через оркестратор»: в проде одновременно (а) голосовой диалог **`use_case = calibration`** с фазами из **`dialogue_phases`** и промптами **`phase_*`**, (б) пайплайн **`/api/calibration/extract`** с усреднением состояния (`calibration` модуль). Оба пути используют общие данные профиля; закрытие Product по голосу может идти через фазу **`acknowledge_and_close`** без повторного вызова extract в том же turn — см. сценарии в приложении.

- **2026-05:** Insight Engine (PATCH 10) в коде: **`insightDetection`** считает CSI/TTM/ETV; **`blockedPhasesForInsight`** блокирует **`ask_practice_intent`** и **`suggest_practice`** для **`daily_dialog`**, если **`isReadyForPractice`** ложно; **`enforceInsightPhaseGuards`** принудительно смещает фазу в **`deepen_inquiry`** или **`offer_insight`** при попытке оркестратора вывести в практику на стадиях **`preconcept`** и **`concept`**. Решение оркестратора по-прежнему на промпте **`orchestrator_decision`** с подстановкой **`insight_metrics_json`**.

- **2026-05:** PATCH 8 / PATCH 9 в данных: активный респондер — **`responder_main` версии 2** (голос автора); фазы деактивируются массово и заменяются библиотекой v2 в **`20260501170500_phase_prompts_v2.sql`** — **11** активных строк с **`prompt_type = 'phase'`** для **`calibration`** и **`daily_dialog`**. Поле **`users.address_form`** добавлено миграцией автора; **`author_voice.json`** подключается через **`authorVoice.ts`**.

- **2026-05:** PATCH 13 в данных и коде: **`monologue_morning_recommendation`** активна версия **2**; сценарий и схема **`morning_recommendation`** допускают **`math_level`**; сценарий **`deep_explanation`** и промпт **`monologue_deep_explanation`** **деактивированы** (`20260501185700_monologue_prompts_v2.sql`). Утренний монолог собирает топ-3 лепестка по **`ranked_planets`** или сортировке **`importance`**.

- **2026-05:** Оптимизации MODULE_4 частично совпадают с кодом: **`greetingBypassDecision`**, **`contextSimilarity`**, **`shouldForceFreshDecision`**, **`decision_source`** / **`cache_similarity`** в объекте решения и в **`user_event_log`**. В **`messages.meta`** хранится полный **`orchestrator_decision`**, не только `decision_source` отдельным полем.

- **2026-05:** Продуктовое напряжение: **`choosePractice`** берёт чакру из **`planet_of_the_day`**, монолог утра — топ-3 по importance (**`topPetals`**). История решения — зафиксировать при следующей ревизии UX практики vs утреннего текста.

Исторические ТЗ (полный текст): **`docs/05_archive/migrated/assistant/`** (PATCH 8, 9, 10, 12, 13, MODULE_4). **`MODULE_3_Calibration_TZ.md`** остаётся в **`docs/05_archive/migrated/calibration/`**; смешанный бриф **`assistant_practice_recommendation_brief.md`** — в **`docs/05_archive/migrated/practices/`**.
