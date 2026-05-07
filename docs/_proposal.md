---
id: docs/_proposal
title: Финальное предложение по структуре документации
version: 1.0
updated: 2026-05-07
depends_on: [docs/_audit]
code_refs: [app/_layout.tsx, app/(tabs)/index.tsx, app/(tabs)/profile.tsx, app/asana-practice.tsx, app/calibration.tsx, modules/access/core/access.tsx, modules/access/core/features.ts, modules/astro-core/index.ts, modules/daily-engine/index.ts, modules/communicator/ui/Communicator.tsx, modules/practices/ui/PracticeCatalogScreen.tsx, modules/mandala/ui/MandalaCanvas.tsx, modules/mandala-sound/core/engine.ts, modules/biofeedback/bus/biofeedback-pipeline.ts, _legacy_web/app/api/communicator/v2/dialog/route.ts, supabase/functions/auto-calibrate/index.ts]
---

# Целевое предложение

## Продуктовая рамка

Проект фиксируется как мобильное астрологическое приложение с практиками, биометрией и AI-ассистентом.

Центральный пользовательский поток:

`регистрация -> профиль -> калибровка голосом -> дневной прогноз -> опциональный AI-диалог -> практика -> отчёт`

Альтернативный поток:

`каталог практик -> запуск практики -> отчёт`

Ключевые архитектурные опоры:

- единственная активная визуальная архитектура: `Mandala + Bindu`;
- Lotus-линия считается замороженным экспериментом и живёт только в `05_archive/lotus_experiment/`;
- код является источником истины при всех расхождениях;
- сопровождаемость важнее скорости локальной разработки;
- структура должна выдерживать рост новых практик, новых движков и новых подписочных сценариев без перестройки верхнего уровня.

## Целевое дерево папок и файлов

```text
docs/
  00_index/
    MAP.md
    GLOSSARY.md
    CHANGELOG.md

  01_foundation/
    architecture.md
    product_model.md
    repository_structure.md
    tech_stack.md
    integrations.md
    i18n.md
    runtime_modes.md

  02_modules/
    astro/
      spec.md
      caching_strategy.md
      interpretation_layers.md
      dependencies.md
      history.md
    calibration/
      spec.md
      dependencies.md
      history.md
    profile/
      spec.md
      dependencies.md
      history.md
    daily_forecast/
      spec.md
      dependencies.md
      history.md
    assistant/
      spec.md
      prompts_and_models.md
      dependencies.md
      history.md
    communicator/
      spec.md
      dependencies.md
      history.md
    practices/
      spec.md
      dependencies.md
      history.md
    bindu/
      spec.md
      evolution_lab.md
      dependencies.md
      history.md
    audio/
      spec.md
      dependencies.md
      history.md
    biofeedback/
      spec.md
      metrics.md
      analytics_collection.md
      dependencies.md
      history.md
      roadmap.md
    subscription/
      spec.md
      dependencies.md
      history.md
    infra/
      spec.md
      pwa.md
      build_pipeline.md
      error_tracking.md
      dependencies.md
      history.md
    webinars/
      spec.md
    author_presence/
      spec.md
      integrations.md

  03_rules/
    documentation.md
    ui_kit.md
    change_protocol.md
    testing.md
    deployment_and_env.md
    media_and_assets.md
    writing_style.md

  04_workspace/
    current.md
    open_questions.md
    research.md

  05_archive/
    lotus_experiment/
    old_briefs/
    historical_specs/
    patch_series_2026_04_29/
    research_assets/
    meta/
```

## Что должно быть в `00_index/MAP.md`

`MAP.md` не должен быть одной плоской таблицей. Он должен иметь две секции.

### Секция 1. User Flow

Порядок строк:

`profile -> calibration -> daily_forecast -> assistant <-> communicator -> practices -> report`

Для каждой строки:

`Модуль | Папка в docs | Точки входа в коде | Зависит от | От него зависят`

### Секция 2. Engines & Services

Порядок строк:

`astro -> bindu -> audio -> biofeedback -> subscription -> infra -> error_tracking -> webinars (planned) -> author_presence (planned)`

Здесь `error_tracking` показывается как capability внутри `infra`, но отдельной строкой в MAP, чтобы его было легко находить.

## Эталон формата

### Эталонный YAML-заголовок

```yaml
---
id: 02_modules/astro/spec
title: Astro Module Specification
version: 1.0
updated: 2026-05-06
depends_on: [01_foundation/architecture, 02_modules/subscription/spec]
code_refs: [modules/astro-core/index.ts, _legacy_web/app/api/astro/daily-forecast/route.ts, supabase/functions/daily-forecast/index.ts]
---
```

### Эталонная строка `MAP.md`

```text
astro | 02_modules/astro/ | modules/astro-core/index.ts; _legacy_web/app/api/astro/daily-forecast/route.ts; supabase/functions/daily-forecast/index.ts | infra, subscription | daily_forecast, assistant
```

## Реестр модулей `02_modules/`

Ниже фиксируется окончательный набор из 14 модулей. Первые 12 активны. Последние 2 создаются сразу как planned-папки с `spec.md`.

| Модуль | Роль | Точки входа в коде | Файлы внутри |
| --- | --- | --- | --- |
| `astro/` | Натальные и транзитные карты, расчёт прогноза, кэширование, 4 слоя интерпретации | `modules/astro-core/index.ts`, `modules/daily-engine/index.ts`, `_legacy_web/app/api/astro/natal/route.ts`, `_legacy_web/app/api/astro/daily-forecast/route.ts`, `supabase/functions/daily-forecast/index.ts` | `spec.md`, `caching_strategy.md`, `interpretation_layers.md`, `dependencies.md`, `history.md` |
| `calibration/` | Голосовая калибровка профиля, коррекция планетарной силы/гармоничности, автокалибровка | `app/calibration.tsx`, `_legacy_web/app/api/calibration/*`, `supabase/functions/auto-calibrate/*` | `spec.md`, `dependencies.md`, `history.md` |
| `profile/` | Профиль пользователя, `ProfileScreen`, смена birth data, интеграционные точки профиля | `app/(tabs)/profile.tsx`, `app/(tabs)/index.tsx` (birth-data modal flow), `modules/auth/*`, `services/natalProfileClient.ts` | `spec.md`, `dependencies.md`, `history.md` |
| `daily_forecast/` | Формирование главного экрана, дневного прогноза и рекомендаций | `app/(tabs)/index.tsx`, `modules/home/useDayContent.ts`, `modules/home/ui/*`, `services/dayContentCache.ts`, `services/dailyForecastClient.ts` | `spec.md`, `dependencies.md`, `history.md` |
| `assistant/` | Оркестрация AI-диалога, сценарии примерно на 5 сообщений, выбор практики, связь с прогнозом | `_legacy_web/app/api/communicator/v2/dialog/route.ts`, `_legacy_web/app/api/_utils/scenarios.ts`, `_legacy_web/app/api/_utils/prompts.ts`, `supabase/seed.sql` | `spec.md`, `prompts_and_models.md`, `dependencies.md`, `history.md` |
| `communicator/` | UI голосового чата: запись, распознавание, воспроизведение, SSE/UI-состояние; без продуктовой логики ассистента | `modules/communicator/ui/Communicator.tsx`, `modules/communicator/ui/*`, `services/communicator-client.ts` | `spec.md`, `dependencies.md`, `history.md` |
| `practices/` | Каталог, запуск, выполнение, отчёт и будущая аналитика практик | `modules/practices/*`, `app/(tabs)/practices.tsx`, `app/asana-practice.tsx`, `app/breath-coherence.tsx`, `services/practiceSessions.ts` | `spec.md`, `dependencies.md`, `history.md` |
| `bindu/` | Активный движок визуализации мандалы; используется в дыхании и медитации | `modules/mandala/ui/MandalaCanvas.tsx`, `modules/mandala/ui/evolution-registry.ts`, `modules/mandala/ui/lotus-bloom-evolution-shader.ts`, `app/mandala-sandbox.tsx`, `app/sacred-symbol-stream.tsx`, `app/bindu-succession-lab.tsx` | `spec.md`, `evolution_lab.md`, `dependencies.md`, `history.md` |
| `audio/` | `AudioMixer`, `ToneEngine`, бинауральные ритмы, слои звука для практик | `modules/mandala-sound/core/engine.ts`, `modules/mandala-sound/core/timeline.ts`, `modules/mandala-sound/core/sync.ts`, `modules/mandala-sound/ui/MandalaSoundProvider.tsx` | `spec.md`, `dependencies.md`, `history.md` |
| `biofeedback/` | PPG с фонарика, HRV/RMSSD/RSA/stress/coherence, синхронизация дыхания с пульсом, сбор метрик | `modules/biofeedback/bus/biofeedback-pipeline.ts`, `modules/biofeedback/core/metrics.ts`, `modules/biofeedback/engines/*`, `modules/biofeedback/sensors/FingerPpgCameraSource.tsx`, `modules/breath/ui/CoherenceBreathScreen.tsx` | `spec.md`, `metrics.md`, `analytics_collection.md`, `dependencies.md`, `history.md`, `roadmap.md` |
| `subscription/` | Подписочная модель и access control для всего приложения | `modules/access/core/access.tsx`, `modules/access/core/features.ts`, `modules/access/core/tiers.ts`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/profile.tsx`, `modules/practices/ui/PracticeCatalogScreen.tsx`, `app/asana-practice.tsx` | `spec.md`, `dependencies.md`, `history.md` |
| `infra/` | Техническое основание: PWA/web-shell, сборки, линтинг, окружения, error tracking | `_legacy_web/app/layout.tsx`, `_legacy_web/next.config.ts`, `.vercelignore`, `package.json`, `supabase/README.md` | `spec.md`, `pwa.md`, `build_pipeline.md`, `error_tracking.md`, `dependencies.md`, `history.md` |
| `webinars/` | Planned: приглашения, вопросы, голосование, фильтрация по тарифу | `требует уточнения: не реализовано в коде` | `spec.md` |
| `author_presence/` | Planned: аватар автора, сторис, ощущение живого присутствия, интеграции Telegram/Instagram | `требует уточнения: не реализовано в коде` | `spec.md`, `integrations.md` |

### Уточнения по модулям

- `assistant/` и `communicator/` сознательно разделены: первый модуль содержит продуктовый интеллект, второй только UI/voice transport.
- При миграции `assistant/` учитывать архивный источник: `docs/05_archive/migrated/calibration/calibration_and_orchestrator.md` (раздел про оркестратор и фазы диалога — переехал сюда при миграции calibration).
- Модуль `practices/`: каноническая триада `spec.md` + `dependencies.md` + `history.md` (`docs/03_rules/migration_protocol.md`). Итоговые метрики дыхания, экраны медитации/асан и ограничения (в т.ч. planned UI вроде `SmartCalibrationOverlay` / `SeriesProgress`) описываются в `spec.md` (§3–5); отдельного модуля `report` нет.
- `bindu/evolution_lab.md` должен собрать материалы из `bindu_succession_lab.md` и `bindu_succession_visual_spec_v2.md`; по смыслу это частично дублирующие документы одной лабораторной ветки, поэтому рекомендуется единый файл с разделами `runtime experiments` и `visual spec`.
- `biofeedback/` включает то, что владелец называет `breath-coherence-timeline`: в текущем коде это не отдельный символ, а таймлайновый слой дыхательной сессии, собираемый из планировщика фаз дыхания, pulse/HRV snapshots и экспортного контура результатов. Это нужно описывать как часть `spec.md` и `metrics.md`, а не выделять в отдельный модуль.
- `infra/pwa.md` нужен не как описание основного клиента, а как описание остаточного web-shell/PWA-контура и ограничений: мобильный клиент основной, PWA вторична и исторична.

## Что должно быть в `01_foundation/`

- `architecture.md` — одна активная картина проекта: mobile app + server API + Supabase + engines.
- `product_model.md` — user flow, практики, подписки, роль ассистента, роль биометрии.
- `repository_structure.md` — карта репозитория: `app/`, `modules/`, `_legacy_web/`, `supabase/`, `services/`, `scripts/`.
- `tech_stack.md` — Expo, RN, Vercel API, Supabase, web-shell.
- `integrations.md` — Vimeo, Supabase, Vercel API, Hume audio requirements.
- `i18n.md` — подход к интернационализации.
- `runtime_modes.md` — app runtime modes, включая debug/testing toggles.

### Что должно быть в `01_foundation/i18n.md`

Файл должен фиксировать:

- текущий факт: приложение сейчас ориентировано на русский, но в коде уже есть RU/EN patterns в `modules/home/i18n/home.ts`, `modules/communicator/i18n/communicator.ts`, `modules/breath/i18n/coherence.ts`, `modules/bootstrap/AppStartupProvider.tsx`;
- правило: новые строки не хардкодить в UI, а класть в модульные i18n-слои;
- правило: язык определять через профиль/настройки или согласованный fallback, а не через локальные ad-hoc проверки;
- правило: если строка участвует в логике ассистента или серверной генерации, надо отдельно отметить, где локализация UI, а где локализация промптов/response templates;
- правило: в новых модулях сразу закладывать место под `ru` и `en`, даже если `en` ещё не заполнен.

## Что должно быть в `03_rules/`

- `documentation.md` — YAML header, правила ссылок, правило "один домен -> один канонический пакет docs".
- `ui_kit.md` — public UI primitives, tokens, светлая и тёмная темы, запрет на разъезд темы по экранам.
- `change_protocol.md` — обязательный протокол внесения изменений.
- `testing.md` — правила smoke/manual/automated testing.
- `deployment_and_env.md` — env, deploy, sync Vercel/Supabase.
- `media_and_assets.md` — аудио, иконки, видео, Hume audio constraints.
- `writing_style.md` — тональность текста и терминология.

## Что должно быть в `04_workspace/`

Папка упрощается до трёх файлов:

- `current.md` — что в работе сейчас;
- `open_questions.md` — подвешенные рабочие вопросы;
- `research.md` — гипотезы на будущее: cellular automata для медитации, новые дыхательные паттерны, внешние пульсометры и т.д.

## Полный план миграции существующих файлов

### Корень `docs/`

| Текущий файл | Куда переносить | Решение |
| --- | --- | --- |
| `docs/_audit.md` | `05_archive/meta/_audit_2026-05-06.md` | архивный снимок перед реорганизацией |
| `docs/_proposal.md` | `05_archive/meta/_proposal_2026-05-06.md` после утверждения | архив решения владельца |
| `docs/android-adaptation-notes.md` | `02_modules/biofeedback/history.md` + `02_modules/infra/history.md` | частично; Android notes не отдельный модуль |
| `docs/biofeedback-architecture.md` | `02_modules/biofeedback/spec.md` | канонизировать по текущему pipeline |
| `docs/biofeedback-parity-contract.md` | `02_modules/biofeedback/metrics.md` | полезные инварианты включить в metrics |
| `docs/breath-coherence-pipeline.md` | `02_modules/practices/spec.md` + `02_modules/biofeedback/spec.md` | разделить UX-поток и метрический движок |
| `docs/design-tokens.md` | `03_rules/ui_kit.md` | перенести как часть UI kit |
| `docs/documentation_standard.md` | `03_rules/documentation.md` | переписать под новую систему |
| `docs/hrv-rmssd-stress-algorithms.md` | `05_archive/historical_specs/hrv-rmssd-stress-algorithms.md` | вывести из активного слоя |
| `docs/hume_integration.md` | `01_foundation/integrations.md` + `03_rules/media_and_assets.md` | оставить только актуальный Hume contract |
| `docs/meditation_video_generator_spec.md` | `02_modules/bindu/spec.md` + `02_modules/practices/spec.md` + `05_archive/lotus_experiment/meditation_video_generator_spec.md` | active часть про Bindu сохранить, Lotus-фрагменты архивировать |
| `docs/product_logic.md` | `01_foundation/product_model.md` | переписать по текущему продукту |
| `docs/roadmap.md` | `04_workspace/research.md` + `04_workspace/current.md` | развести текущее и гипотезы |
| `docs/system_structure.md` | `01_foundation/repository_structure.md` | переписать под актуальный код |
| `docs/tech_stack.md` | `01_foundation/tech_stack.md` + `02_modules/infra/spec.md` | убрать противоречия про PWA |
| `docs/testing-mode.md` | `01_foundation/runtime_modes.md` | это runtime toggle, а не процесс тестирования кода |
| `docs/user-diagnostic-json-reception.md` | `03_rules/testing.md` + `04_workspace/current.md` | часть в правила, часть в рабочие инструкции |
| `docs/last_session2.json` | `tmp/last_session2.json` в корне репозитория | это большой автодамп, не документация; лучше вынести, а не удалять, чтобы не потерять материал |
| `docs/last_session3.json` | `tmp/last_session3.json` в корне репозитория | то же решение |
| `docs/sound.py` | `scripts/hume_stream_demo.py` | это утилитарный Hume-скрипт вне рантайма; не хранить в `docs/` и не относить к runtime `audio` |

### `docs/modules/`

| Текущий файл | Куда переносить | Решение |
| --- | --- | --- |
| `docs/modules/bindu_succession_lab.md` | `02_modules/bindu/evolution_lab.md` | активная лаборатория Bindu |
| `docs/modules/bindu_succession_visual_spec_v2.md` | `02_modules/bindu/evolution_lab.md` + `05_archive/historical_specs/bindu_succession_visual_spec_v2.md` | слить полезное в `evolution_lab.md`, исходник архивировать |
| `docs/modules/calibration_and_orchestrator.md` | `02_modules/calibration/spec.md` + `02_modules/assistant/dependencies.md` | разрезать на два домена |
| `docs/modules/communicator_roadmap.md` | `02_modules/assistant/history.md` + `02_modules/communicator/history.md` + `04_workspace/research.md` | разнести roadmap и факты |
| `docs/modules/continuous_ca_research_notes.md` | `05_archive/lotus_experiment/continuous_ca_research_notes.md` | заморожено |
| `docs/modules/lotus_bloom_evolution_strategy.md` | `05_archive/lotus_experiment/lotus_bloom_evolution_strategy.md` | заморожено |
| `docs/modules/lotus_bloom_evolving_requirements.md` | `05_archive/lotus_experiment/lotus_bloom_evolving_requirements.md` | заморожено |
| `docs/modules/mandala.md` | `02_modules/bindu/spec.md` | активную часть переформулировать как Bindu |
| `docs/modules/mandala_sound.md` | `02_modules/audio/spec.md` | активный звук уходит в `audio/` |
| `docs/modules/meditation_session_dramaturgy.md` | `05_archive/lotus_experiment/meditation_session_dramaturgy.md` | архив |
| `docs/modules/visual_module_map.md` | `00_index/MAP.md` + `02_modules/bindu/dependencies.md` | активную карту переписать, Lotus убрать |

### `docs/planning/`

| Текущий файл | Куда переносить | Решение |
| --- | --- | --- |
| `docs/planning/access_tiers_navigation_brief.md` | `02_modules/subscription/history.md` + `05_archive/old_briefs/access_tiers_navigation_brief.md` | decisions в history, исходник в архив |
| `docs/planning/assistant_practice_recommendation_brief.md` | `02_modules/assistant/history.md` + `02_modules/practices/history.md` + `05_archive/old_briefs/assistant_practice_recommendation_brief.md` | разнести по `assistant` и `practices` |
| `docs/planning/practices_module_brief.md` | `02_modules/practices/spec.md` + `05_archive/old_briefs/practices_module_brief.md` | актуализировать по коду |
| `docs/planning/spiral_day1_day2_plan.md` | `05_archive/old_briefs/spiral_day1_day2_plan.md` | исторический план |
| `docs/planning/vimeo_asanas_import_brief.md` | `02_modules/practices/spec.md` + `05_archive/old_briefs/vimeo_asanas_import_brief.md` | активная часть в `spec.md` |

### `docs/remote-play/`

| Текущий файл | Куда переносить | Решение |
| --- | --- | --- |
| `docs/remote-play/README.md` | `02_modules/practices/spec.md` + `02_modules/infra/pwa.md` | Remote Play важен для выполнения асан и web-shell |
| `docs/remote-play/wordpress-snippet.html` | `05_archive/research_assets/remote_play/wordpress-snippet.html` + ссылка из `02_modules/practices/spec.md` | reference asset, не канон |

### `docs/tmp_docs/02052026/`

Все 5 файлов из `docs/tmp_docs/02052026/` — дубли planning-слоя. Все уходят в `05_archive/old_briefs/` без включения в активный контур.

### `docs/tmp_docs/29042026/`

| Текущий файл | Куда переносить | Решение |
| --- | --- | --- |
| `00_OPTIMIZATION_PLAN.md` | `05_archive/patch_series_2026_04_29/00_OPTIMIZATION_PLAN.md` | архивный индекс серии |
| `MASTER_README.md` | `05_archive/historical_specs/MASTER_README_2026-04-29.md` | оставить как исторический снимок |
| `MIGRATION_PLAN.md` | `05_archive/historical_specs/MIGRATION_PLAN_2026-04-29.md` + выборочно в `04_workspace/research.md` | не делать активным каноном |
| `MODULE_1_AstroCore_TZ.md` | `02_modules/astro/history.md` + `02_modules/astro/spec.md` | перенести подтверждённые решения |
| `MODULE_2_DailyEngine_TZ.md` | `02_modules/astro/history.md` + `02_modules/daily_forecast/history.md` | разнести по фактическим доменам |
| `MODULE_3_Calibration_TZ.md` | `02_modules/calibration/history.md` | активный источник решений по калибровке |
| `MODULE_4_AIAssistant_TZ.md` | `02_modules/assistant/history.md` + `02_modules/assistant/spec.md` | активный источник решений по assistant |
| `PATCH_1_M3_averaging_ratio.md` | `02_modules/calibration/history.md` | решение по calibration |
| `PATCH_2_dialog_history_order.md` | `02_modules/assistant/history.md` | решение по orchestration/history |
| `PATCH_3_forecast_cache_timezone.md` | `02_modules/astro/caching_strategy.md` + `02_modules/daily_forecast/dependencies.md` | cache и local-day logic |
| `PATCH_4_engine_parity.md` | `02_modules/astro/history.md` | parity между Node/Deno runtime |
| `PATCH_5_RLS_tightening.md` | `02_modules/infra/history.md` | DB/security infrastructure |
| `PATCH_6_proposal_pending_fix.md` | `02_modules/calibration/history.md` | auto-calibrate proposal semantics |
| `PATCH_7_token_optimization_DTO.md` | `02_modules/assistant/history.md` | DTO и prompt-context optimisation |
| `PATCH_8_author_voice_system_prompt.md` | `02_modules/assistant/prompts_and_models.md` + `02_modules/assistant/history.md` | assistant prompt layer |
| `PATCH_9_phase_prompts_library.md` | `02_modules/assistant/prompts_and_models.md` | phase library |
| `PATCH_10_insight_engine.md` | `02_modules/assistant/history.md` | insight engine decisions |
| `PATCH_11_whisper_quality.md` | `02_modules/communicator/history.md` + `02_modules/infra/history.md` | transcription pipeline |
| `PATCH_12_scenarios_architecture.md` | `02_modules/assistant/spec.md` + `02_modules/assistant/history.md` | assistant scenario architecture |
| `PATCH_13_monologue_prompts.md` | `02_modules/daily_forecast/history.md` + `02_modules/assistant/history.md` | home/assistant bridge |
| `PATCH_14_free_tier.md` | `02_modules/subscription/history.md` | access-control decisions |
| `PATCH_15_math_level_and_charts.md` | `02_modules/astro/interpretation_layers.md` + `02_modules/daily_forecast/history.md` | math layer and chart UI |
| `chakra_states_baseline.json.txt` | `05_archive/research_assets/calibration/chakra_states_baseline.json.txt` + ссылка из `02_modules/calibration/history.md` | dataset reference |

### `docs/tmp_docs/` не-markdown assets

| Текущий файл | Куда переносить | Решение |
| --- | --- | --- |
| `docs/tmp_docs/Коммуникатор.txt` | `05_archive/historical_specs/Коммуникатор.txt` + выборочно в `02_modules/assistant/history.md` и `02_modules/communicator/history.md` | historical source |
| `docs/tmp_docs/Дыхание/*` | `05_archive/research_assets/breath/*` | reference assets |
| `docs/tmp_docs/Мандала/Бинду.txt` | `02_modules/bindu/history.md` + `05_archive/research_assets/mandala/Бинду.txt` | часть идей уже активна |
| `docs/tmp_docs/Мандала/Звук.txt` | `02_modules/audio/history.md` + `05_archive/research_assets/mandala/Звук.txt` | часть идей уже активна |
| `docs/tmp_docs/Мандала/Мандала_устаревший.txt` и дубль | `05_archive/research_assets/mandala/` | архив |
| `docs/tmp_docs/Мандала/*.png` | `05_archive/research_assets/mandala/screenshots/` | архив |

## Lotus-эксперимент: что уходит в архив и что уже не потеряно

Все Lotus-материалы уходят в `05_archive/lotus_experiment/`.

При этом часть наработок уже живёт в активном `bindu/` и не теряется:

- lifecycle/evolution profiles (`rebirth`, `tidalBreath`, `spiralDrift`, `haloCascade`) уже выражены в `modules/mandala/core/defaults.ts`, `modules/mandala/core/recipes.ts`, `modules/mandala/ui/lotus-bloom-evolution-shader.ts`;
- `petalProfile` и связанная геометрическая библиотека уже активны в `modules/mandala/core/types.ts`, `modules/mandala/ui/MandalaCanvas.tsx`, `modules/mandala/ui/MandalaSandboxScreen.tsx`;
- `smin` и мягкая эволюционная логика уже присутствуют в `modules/mandala/ui/lotus-bloom-evolution-shader.ts`;
- экспериментальная визуальная лаборатория уже имеет живые точки входа: `app/bindu-succession-lab.tsx`, `app/sacred-symbol-stream.tsx`.

Вывод для плана миграции:

- активные runtime-идеи переносятся в `02_modules/bindu/*`;
- текстовые Lotus-спецификации не остаются в активном слое;
- в архивных Lotus-файлах надо явно пометить: `заморожено, возможный возврат в будущем; часть идей уже перенесена в bindu`.

## Что должно оказаться в `subscription/dependencies.md`

Этот файл должен не просто перечислять соседние модули, а фиксировать конкретные точки проверки тарифа.

Уже видимые по коду места:

- `app/(tabs)/_layout.tsx` — gate на вход в каталог практик;
- `app/(tabs)/index.tsx` — `personal_daily_forecast`, `assistant_dialog`, `calibration`, upgrade dialog;
- `app/(tabs)/profile.tsx` — gate на `stats`;
- `modules/practices/ui/PracticeCatalogScreen.tsx` — `practice_catalog`, `asana_practices`, locked features;
- `app/asana-practice.tsx` — gate на `asana_practices`;
- источник истины по правилам: `modules/access/core/access.tsx`, `modules/access/core/features.ts`, `modules/access/core/tiers.ts`.

## Открытые вопросы к владельцу проекта

Открытых вопросов нет.

## Сводка изменений по сравнению с предыдущей версией

1. Список модулей сокращён и переименован под окончательные 14 папок из решения владельца.
2. `assistant` и `communicator` разведены на интеллект и UI.
3. `subscription` выделен в отдельный сквозной модуль вместо распределённого описания в access/home.
4. `bindu` и `audio` переименованы из более технических промежуточных названий.
5. `04_workspace/` упрощён до трёх файлов: `current.md`, `open_questions.md`, `research.md`.
6. В `01_foundation/` добавлены `i18n.md` и `runtime_modes.md`.
7. В `03_rules/` добавлены обязательные `ui_kit.md` и подробный `change_protocol.md`.
8. Добавлен явный план для `last_session2.json`, `last_session3.json`, `sound.py`, `testing-mode.md`.
9. Lotus-архив дополнен пометкой о том, какие идеи уже живут в `bindu`.
10. Зафиксированы эталонные форматы YAML header и строки `MAP.md`.

## Черновик `03_rules/change_protocol.md`

Ниже не идея, а рабочий черновик будущего файла.

### 1. Починка бага в конкретном экране

Чек-лист:

1. Найти экран и сопоставить его с модулем в `00_index/MAP.md`.
2. Открыть `02_modules/<module>/dependencies.md` и проверить:
   - от каких модулей экран получает данные;
   - какие gates/feature flags на него влияют;
   - есть ли серверные зависимости.
3. Исправить код в минимальном домене, не разнося логику по соседним модулям.
4. Проверить смежные entry points того же модуля.
5. Если изменился контракт данных или переходов:
   - обновить `spec.md`;
   - обновить `dependencies.md`;
   - добавить запись в `history.md`.
6. Если это bugfix подписки, AI или кэширования:
   - дополнительно проверить `subscription/`, `assistant/` или `astro/`.
7. Перед завершением обновить `00_index/CHANGELOG.md`.

### 2. Добавление новой дыхательной практики

Чек-лист:

1. Начать с `02_modules/practices/spec.md` (дыхательный подсценарий, §3–4): описать новый паттерн, цель, входные параметры, ограничения.
2. Проверить `02_modules/biofeedback/dependencies.md`: нужна ли синхронизация по пульсу, какие метрики обязательны.
3. Проверить `02_modules/audio/dependencies.md`: нужен ли новый звуковой слой или новая схема микса.
4. Проверить `02_modules/bindu/dependencies.md`: нужен ли отдельный визуальный preset или достаточно существующего.
5. Обновить каталог и launch-логику в `practices`.
6. Если практика доступна не всем тарифам, обновить `subscription/spec.md` и `subscription/dependencies.md`.
7. Если практика меняет итоговый отчёт или метрики завершения, обновить `practices/spec.md` и при необходимости `practices/history.md`.
8. Если это экспериментальная практика, зафиксировать это в `practices/history.md` и `04_workspace/research.md`.

### 3. Изменение логики access control / тарифов

Чек-лист:

1. Начать только с `02_modules/subscription/spec.md`.
2. Обновить источник истины по кодовым правилам доступа.
3. Открыть `02_modules/subscription/dependencies.md` и пройти по всем перечисленным точкам проверки.
4. Проверить минимум:
   - `app/(tabs)/_layout.tsx`;
   - `app/(tabs)/index.tsx`;
   - `app/(tabs)/profile.tsx`;
   - `modules/practices/ui/PracticeCatalogScreen.tsx`;
   - `app/asana-practice.tsx`.
5. Если меняется продуктовый смысл тарифа, обновить `01_foundation/product_model.md`.
6. Если меняются upgrade surfaces, обновить `profile/spec.md`, `daily_forecast/spec.md` или `practices/spec.md`.
7. Добавить запись в `subscription/history.md` с причиной изменения и affected modules.

### 4. Добавление нового движка визуализации

Чек-лист:

1. Сначала решить: это расширение `bindu` или отдельная исследовательская линия.
2. Если движок должен войти в runtime:
   - документировать его в `02_modules/bindu/spec.md`;
   - детали эксперимента класть в `02_modules/bindu/evolution_lab.md`;
   - зависимости описывать в `02_modules/bindu/dependencies.md`.
3. Если движок пока исследовательский:
   - гипотезу сначала писать в `04_workspace/research.md`;
   - после решения о внедрении переносить в `bindu/`.
4. Проверить интеграцию с медитацией и дыханием в `02_modules/practices/spec.md` (и связанными экранами в `modules/mandala`, `modules/breath`).
5. Если движок требует нового sound/biofeedback coupling, обновить `audio/` и `biofeedback/`.
6. Если движок происходит из Lotus/CA-ветки, архивную связь отметить в `bindu/history.md`, но не возвращать Lotus в активную архитектуру.

### 5. Изменение логики astro

Чек-лист:

1. Начать с `02_modules/astro/spec.md`.
2. Сразу определить, что меняется:
   - расчёт;
   - кэширование;
   - интерпретационные слои;
   - контракты выдачи.
3. Если меняется кэширование, обновить `astro/caching_strategy.md` и проверить все forecast consumers.
4. Если меняются уровни объяснения, обновить `astro/interpretation_layers.md` и `daily_forecast/spec.md`.
5. Проверить серверные входы:
   - `_legacy_web/app/api/astro/*`;
   - `supabase/functions/daily-forecast/index.ts`.
6. Проверить клиентские входы:
   - `modules/home/useDayContent.ts`;
   - `app/(tabs)/index.tsx`;
   - assistant, если он опирается на дневной прогноз.
7. Добавить запись в `astro/history.md` с указанием affected cache semantics и downstream modules.

## Что не помещается в активную структуру

1. Служебные snapshots и proposals не должны жить в корне `docs/`; им место в `05_archive/meta/`.
2. Автогенерируемые JSON dumps не являются документацией; им место в `tmp/` корня репозитория.
3. Исследовательские скрипты вроде `sound.py` не являются документацией; им место в `scripts/` или `tools/`.
4. Сырые txt/pdf/png/json источники не должны становиться каноном; они должны жить в `05_archive/research_assets/` и только ссылаться из активных docs.

## Итог

Предлагаемая структура делает две вещи одновременно:

- оставляет один активный контур документации по текущему коду;
- сохраняет исторический и исследовательский слой без смешивания его с каноном.

Это достаточная основа, чтобы на следующем шаге создать скелет документации без повторного проектирования структуры.
