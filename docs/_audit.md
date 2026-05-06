# Аудит документации HARMONIZER

Проверены:

- все `.md` в `docs/` (`59` файлов);
- дополнительные материалы в `docs/tmp_docs/`:
  `docs/tmp_docs/Коммуникатор.txt`,
  `docs/tmp_docs/Дыхание/Канальное_дыхание.txt`,
  `docs/tmp_docs/Дыхание/Когерентное_дыхание.txt`,
  `docs/tmp_docs/Дыхание/Когерентное дыхание.pdf`,
  `docs/tmp_docs/Дыхание/Ритмичное_дыхание.txt`,
  `docs/tmp_docs/Мандала/Бинду.txt`,
  `docs/tmp_docs/Мандала/Звук.txt`,
  `docs/tmp_docs/Мандала/Мандала_устаревший.txt`,
  `docs/tmp_docs/Мандала/Мандала_устаревший.txt`,
  `docs/tmp_docs/Мандала/1Снимок экрана 2026-04-09 в 21.53.48.png`,
  `docs/tmp_docs/Мандала/2Снимок экрана 2026-04-09 в 21.54.12.png`,
  `docs/tmp_docs/29042026/chakra_states_baseline.json.txt`;
- актуальный код в `app/`, `modules/`, `services/`, `_legacy_web/app/api/`, `supabase/`.

Статусы ниже:

- `актуально` — документ соответствует текущему коду или текущему процессу;
- `частично актуально` — документ полезен, но уже неполон или местами устарел;
- `исторический источник` — важен как источник требований/контекста, но не как каноническая документация;
- `неактуально` — описывает архитектуру или файлы, которых в текущем коде уже нет;
- `требует уточнения` — связь с кодом или степень актуальности нельзя уверенно зафиксировать.

## Инвентарь существующей документации

### Общесистемные документы

- `docs/android-adaptation-notes.md` — реестр iOS-only мест и задач на Android-порт для `modules/biofeedback-finger-frame-processor` и связанных экранов. Статус: `актуально`, потому что код всё ещё содержит `TAG_ANDROID_ADAPTATION` и null-safe Android fallback в `modules/biofeedback-finger-frame-processor/src/index.ts`. Последнее изменение: `2026-04-23`.
- `docs/biofeedback-architecture.md` — целевая архитектура нового pipeline biofeedback после рефакторинга. Статус: `актуально`; соответствует `modules/biofeedback/bus/biofeedback-pipeline.ts`, `modules/biofeedback/adapters/MandalaBioFrameAdapter.ts`, `modules/biofeedback/engines/*`. Последнее изменение: `2026-04-16`.
- `docs/biofeedback-parity-contract.md` — инварианты формул и порогов после разборки старого анализатора. Статус: `актуально`; соответствует `modules/biofeedback/core/metrics.ts`, `modules/breath/core/coherence-session-analysis.ts`, `modules/biofeedback/constants.ts`. Последнее изменение: `2026-04-20`.
- `docs/breath-coherence-pipeline.md` — детальный путь от камеры до метрик когерентного дыхания и JSON-экспорта. Статус: `частично актуально`; основная цепочка соответствует `modules/breath/ui/CoherenceBreathScreen.tsx` и `modules/biofeedback/*`, но документ сфокусирован на export v2, тогда как рядом уже живёт v3 в `modules/biofeedback/export/SessionExporter.ts`. Последнее изменение: `2026-04-19`.
- `docs/design-tokens.md` — справочник токенов оформления и типографики. Статус: `актуально`; ссылается на реальный источник истины `modules/ui/theme.ts`. Последнее изменение: `2026-04-20`.
- `docs/documentation_standard.md` — правило, что у каждого модуля должен быть `modules/<name>/readme.md`. Статус: `частично актуально`; правило полезно, но в коде сейчас readme есть только у `modules/access`, `modules/auth`, `modules/biofeedback`, `modules/breath`, `modules/communicator`, `modules/mandala`, `modules/mandala-sound`, `modules/practices`. Последнее изменение: `2026-04-17`.
- `docs/hrv-rmssd-stress-algorithms.md` — старое описание RMSSD/Баевского для пальцевого PPG. Статус: `неактуально`; документ ссылается на отсутствующие `modules/biofeedback/core/finger-analysis.ts` и `modules/biofeedback/core/mandala-adapter.ts`, а текущая архитектура перенесена в `modules/biofeedback/bus/`, `modules/biofeedback/engines/`, `modules/biofeedback/adapters/`. Последнее изменение: `2026-04-17`.
- `docs/hume_integration.md` — регламент параметров аудио для будущей интеграции Hume. Статус: `частично актуально`; требования `16 kHz`, `mono`, `int16` всё ещё актуальны, но полноценной Hume-интеграции в коде пока нет, есть только контракт-задел в `modules/communicator/readme.md`. Последнее изменение: `2026-04-04`.
- `docs/meditation_video_generator_spec.md` — основная спецификация визуального модуля `MANDALA`. Статус: `частично актуально`; core/runtime соответствует `modules/mandala/*`, но документ уже отстаёт от появления отдельного звукового V1 в `modules/mandala-sound/*`. Последнее изменение: `2026-04-09`.
- `docs/product_logic.md` — краткая продуктовая логика по практикам, чакральному фильтру и тону общения. Статус: `частично актуально`; полезен как идеологический слой, но слишком краток относительно текущих модулей `modules/access`, `modules/practices`, `modules/communicator`, `modules/breath`. Последнее изменение: `2026-04-04`.
- `docs/remote-play/README.md` — описание Remote Play через `tv_sessions` и WordPress snippet. Статус: `актуально`; соответствует `modules/remote-play/*`, `app/connect-tv.tsx`, `app/tv-remote.tsx`, `supabase/migrations/20260503014500_remote_play_tv_sessions.sql`, `docs/remote-play/wordpress-snippet.html`. Последнее изменение: `2026-05-03`.
- `docs/roadmap.md` — продуктовая дорожная карта. Статус: `частично актуально`; документ полезен как стратегический ориентир, но не работает как точный технический источник для текущего состояния модулей. Последнее изменение: `2026-04-04`.
- `docs/system_structure.md` — регламент структуры репозитория и слоёв проекта. Статус: `частично актуально`; верно описывает деление на Expo-клиент и `_legacy_web`, но каталог «текущих модулей» в документе уже неполный относительно `modules/access`, `modules/auth`, `modules/home`, `modules/practices`, `modules/remote-play`, `modules/ui`, `modules/bootstrap`, `modules/location`, `modules/astro-core`, `modules/daily-engine`. Последнее изменение: `2026-04-29`.
- `docs/tech_stack.md` — описание основного технологического стека. Статус: `частично актуально`; верно про Expo/Vercel/Supabase, но не покрывает нынешний серверный контур в `supabase/functions/*` и фактическое смешение `_legacy_web` + Supabase Edge Functions. Последнее изменение: `2026-04-29`.
- `docs/testing-mode.md` — как включать диагностический режим BREATH. Статус: `актуально`; соответствует `modules/breath/config/debug-flags.ts`, `modules/breath/debug/*`, `modules/breath/ui/CoherenceBreathScreen.tsx`. Последнее изменение: `2026-04-23`.
- `docs/user-diagnostic-json-reception.md` — процесс приёма и разбора присланных пользователями diagnostic JSON. Статус: `актуально`; соответствует debug/export контуру из `modules/breath/*` и `modules/biofeedback/export/*`. Последнее изменение: `2026-04-23`.

### Документы `docs/modules/`

- `docs/modules/bindu_succession_lab.md` — описание отдельной R&D-ветки Bindu Succession. Статус: `частично актуально`; в коде ей соответствуют `app/bindu-succession-lab.tsx`, `modules/mandala/experiments/BinduSuccessionLabScreen.tsx`, `modules/mandala/experiments/BinduSuccessionLabCanvas.tsx`. Последнее изменение: `2026-04-09`.
- `docs/modules/bindu_succession_visual_spec_v2.md` — визуальная спецификация Bindu-line. Статус: `исторический источник`; документ полезен для художественного замысла, но канонический контракт сейчас живёт в `modules/mandala/experiments/*` и `docs/modules/visual_module_map.md`. Последнее изменение: `2026-04-08`.
- `docs/modules/calibration_and_orchestrator.md` — краткое описание calibration API и seed-данных оркестратора. Статус: `частично актуально`; соответствует `_legacy_web/app/api/calibration/*`, `_legacy_web/app/api/communicator/v2/dialog/route.ts`, `supabase/seed.sql`, но не покрывает `supabase/functions/auto-calibrate/index.ts` и новые миграции. Последнее изменение: `2026-04-29`.
- `docs/modules/communicator_roadmap.md` — дорожная карта RN-коммуникатора и будущих направлений. Статус: `частично актуально`; V1 соответствует `modules/communicator/*`, но часть будущих шагов уже частично реализована в практике/selector контуре. Последнее изменение: `2026-04-29`.
- `docs/modules/continuous_ca_research_notes.md` — исследовательские заметки по continuous cellular automata для visual layer. Статус: `исторический источник`; в текущем коде нет отдельного модуля CA, есть только следы художественного развития в `modules/mandala/ui/*`. Последнее изменение: `2026-04-08`.
- `docs/modules/lotus_bloom_evolution_strategy.md` — стратегия эволюции образа Lotus Bloom. Статус: `частично актуально`; перекликается с `modules/mandala/ui/lotus-bloom-evolution-shader.ts`, `modules/mandala/ui/evolution-registry.ts`. Последнее изменение: `2026-04-09`.
- `docs/modules/lotus_bloom_evolving_requirements.md` — требования к evolving-режиму Lotus Bloom. Статус: `исторический источник`; часть идей отражена в `modules/mandala/ui/*`, но документ не является текущим контрактом runtime. Последнее изменение: `2026-04-08`.
- `docs/modules/mandala.md` — указатель на текущие документы по `MANDALA`. Статус: `частично актуально`; полезен как index, но сам по себе контракт почти не содержит. Последнее изменение: `2026-04-09`.
- `docs/modules/mandala_sound.md` — описание звукового слоя медитаций и интеграционных точек. Статус: `актуально`; соответствует `modules/mandala-sound/*`, `assets/audio/mandala-sound/*`, `modules/breath/ui/CoherenceBreathScreen.tsx`, `modules/mandala/experiments/SacredSymbolStreamScreen.tsx`. Последнее изменение: `2026-05-03`.
- `docs/modules/meditation_session_dramaturgy.md` — драматургия медитативной сессии. Статус: `исторический источник`; это R&D-слой, а не текущий технический контракт какого-то одного файла. Последнее изменение: `2026-04-08`.
- `docs/modules/visual_module_map.md` — карта визуальных веток (`Bindu`, `Symbol Stream`, `Mandala Sandbox`). Статус: `актуально`; соответствует `app/bindu-succession-lab.tsx`, `app/sacred-symbol-stream.tsx`, `app/mandala-sandbox.tsx`, `modules/mandala/experiments/*`, `modules/mandala/ui/*`. Последнее изменение: `2026-04-09`.

### Документы `docs/planning/`

- `docs/planning/access_tiers_navigation_brief.md` — brief по тарифам, feature gates и навигации. Статус: `частично актуально`; основные идеи реализованы в `modules/access/*`, `app/(tabs)/_layout.tsx`, `app/(tabs)/profile.tsx`. Последнее изменение: `2026-05-03`.
- `docs/planning/assistant_practice_recommendation_brief.md` — brief по рекомендации практик через ассистента. Статус: `частично актуально`; много пунктов реализовано в `modules/practices/*`, `_legacy_web/app/api/communicator/v2/dialog/route.ts`, `_legacy_web/app/api/communicator/v2/dialog/practiceSelection.ts`. Последнее изменение: `2026-05-03`.
- `docs/planning/practices_module_brief.md` — brief по каталогу практик и модели данных. Статус: `частично актуально`; основная структура реализована в `modules/practices/*`, `app/(tabs)/practices.tsx`, `app/asana-practice.tsx`. Последнее изменение: `2026-05-03`.
- `docs/planning/spiral_day1_day2_plan.md` — спиральный план на 1-2 день разработки. Статус: `исторический источник`; важен только как история принятия решений. Последнее изменение: `2026-05-02`.
- `docs/planning/vimeo_asanas_import_brief.md` — brief по импорту Vimeo-асан и данным по ним. Статус: `частично актуально`; соответствует текущим импортным следам в `scripts/backfill-practice-thumbnails.mjs`, `_legacy_web/app/api/practices/vimeo-thumbnails/route.ts`, `services/practice-thumbnails.ts`, но уже не канонический источник. Последнее изменение: `2026-05-03`.

### Дубликаты planning в `docs/tmp_docs/02052026/`

- `docs/tmp_docs/02052026/access_tiers_navigation_brief.md` — копия planning-brief по тарифам и навигации. Статус: `исторический источник`; содержательно дублирует `docs/planning/access_tiers_navigation_brief.md`. Последнее изменение: `2026-05-03`.
- `docs/tmp_docs/02052026/assistant_practice_recommendation_brief.md` — копия planning-brief по ассистенту и рекомендациям практик. Статус: `исторический источник`; дублирует `docs/planning/assistant_practice_recommendation_brief.md`. Последнее изменение: `2026-05-03`.
- `docs/tmp_docs/02052026/practices_module_brief.md` — копия planning-brief по каталогу практик. Статус: `исторический источник`; дублирует `docs/planning/practices_module_brief.md`. Последнее изменение: `2026-05-03`.
- `docs/tmp_docs/02052026/spiral_day1_day2_plan.md` — копия спирального плана. Статус: `исторический источник`; дублирует `docs/planning/spiral_day1_day2_plan.md`. Последнее изменение: `2026-05-02`.
- `docs/tmp_docs/02052026/vimeo_asanas_import_brief.md` — копия brief по Vimeo-асанам. Статус: `исторический источник`; дублирует `docs/planning/vimeo_asanas_import_brief.md`. Последнее изменение: `2026-05-03`.

### Документы `docs/tmp_docs/29042026/`

- `docs/tmp_docs/29042026/00_OPTIMIZATION_PLAN.md` — план патчей и оптимизаций после аудита phase 8. Статус: `исторический источник`; полезен как индекс патч-серии, но не как текущая документация. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/MASTER_README.md` — общий архитектурный снимок старой версии приложения. Статус: `исторический источник`; часть понятий уже разошлась по `modules/*`, `_legacy_web/app/api/*`, `supabase/*`. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/MIGRATION_PLAN.md` — пошаговый план внедрения Orchestrator architecture. Статус: `исторический источник`; большая часть уже материализована в коде и миграциях. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/MODULE_1_AstroCore_TZ.md` — ТЗ по Astro-Core. Статус: `исторический источник`; код есть в `modules/astro-core/*`, но канонической текущей документации для него нет. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/MODULE_2_DailyEngine_TZ.md` — ТЗ по Daily-Engine. Статус: `исторический источник`; код есть в `modules/daily-engine/*`, `_legacy_web/app/api/astro/daily-forecast/route.ts`, `supabase/functions/daily-forecast/index.ts`, но текущего канонического doc-модуля нет. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/MODULE_3_Calibration_TZ.md` — ТЗ по calibration. Статус: `исторический источник`; backend и UX реализованы через `_legacy_web/app/api/calibration/*`, `app/calibration.tsx`, `supabase/functions/auto-calibrate/index.ts`, но документ не обновлялся после патчей. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/MODULE_4_AIAssistant_TZ.md` — ТЗ по AI assistant/orchestrator. Статус: `исторический источник`; большая часть разнесена по `_legacy_web/app/api/communicator/v2/*`, `modules/communicator/*`, `modules/practices/*`, миграциям `supabase/migrations/*`. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/PATCH_10_insight_engine.md` — патч про Insight Engine и готовность к практике. Статус: `исторический источник`; идеи отражены в `_legacy_web/app/api/communicator/v2/dialog/route.ts`. Последнее изменение: `2026-05-01`.
- `docs/tmp_docs/29042026/PATCH_11_whisper_quality.md` — патч про качество Whisper/transcription. Статус: `исторический источник`; релевантен текущим `_legacy_web/app/api/communicator/v2/transcribe/route.ts`, `_legacy_web/app/api/calibration/transcribe/route.ts`. Последнее изменение: `2026-05-01`.
- `docs/tmp_docs/29042026/PATCH_12_scenarios_architecture.md` — патч по scenarios architecture. Статус: `исторический источник`; идеи отражены в `_legacy_web/app/api/_utils/scenarios.ts` и маршрутах AI/dialog. Последнее изменение: `2026-05-01`.
- `docs/tmp_docs/29042026/PATCH_13_monologue_prompts.md` — патч по monologue prompts, математическому уровню и утренним рекомендациям. Статус: `исторический источник`; реализованные следы есть в `_legacy_web/app/api/ai/monologue/route.ts`, `_legacy_web/app/api/_utils/morningRecommendation.ts`, `modules/home/useDayContent.ts`. Последнее изменение: `2026-05-01`.
- `docs/tmp_docs/29042026/PATCH_14_free_tier.md` — патч по free tier и общим рекомендациям. Статус: `исторический источник`; отражён в `modules/access/*`, `modules/home/useDayContent.ts`, `_legacy_web/app/api/ai/global-content/route.ts`. Последнее изменение: `2026-05-01`.
- `docs/tmp_docs/29042026/PATCH_15_math_level_and_charts.md` — патч по math level UI и опциональным картам. Статус: `исторический источник`; частично отражён в `modules/home/ui/ModalMathLevel.tsx`, `modules/home/ui/ModalAstroChart.tsx`, `app/(tabs)/index.tsx`. Последнее изменение: `2026-05-01`.
- `docs/tmp_docs/29042026/PATCH_1_M3_averaging_ratio.md` — патч по пропорциям усреднения в calibration. Статус: `исторический источник`; относится к калибровочному контуру и должен жить рядом с документацией по calibration, а не отдельно. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/PATCH_2_dialog_history_order.md` — патч по загрузке истории сообщений. Статус: `исторический источник`; относится к `_legacy_web/app/api/communicator/v2/dialog/route.ts`. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/PATCH_3_forecast_cache_timezone.md` — патч по инвалидации кеша прогноза по локальному дню. Статус: `исторический источник`; отражён в `modules/home/useDayContent.ts` и `_legacy_web/app/api/calibration/extract/forecast-cache-date.ts`. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/PATCH_4_engine_parity.md` — патч по parity Daily-Engine между Node и Deno. Статус: `исторический источник`; соответствует нынешнему сосуществованию `modules/daily-engine/*`, `_legacy_web/modules/daily-engine/*`, `supabase/functions/_shared/daily-engine-parity.test.ts`. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/PATCH_5_RLS_tightening.md` — патч по ужесточению RLS. Статус: `исторический источник`; реализован миграциями в `supabase/migrations/*`. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/PATCH_6_proposal_pending_fix.md` — патч по «вечному pending» в auto-calibrate. Статус: `исторический источник`; относится к `supabase/functions/auto-calibrate/index.ts` и `supabase/functions/auto-calibrate/proposal.ts`. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/PATCH_7_token_optimization_DTO.md` — патч по компактным DTO для LLM-контекста. Статус: `исторический источник`; реализованные следы есть в `_legacy_web/app/api/_utils/dto.ts` и `_legacy_web/app/api/communicator/v2/dialog/route.ts`. Последнее изменение: `2026-04-29`.
- `docs/tmp_docs/29042026/PATCH_8_author_voice_system_prompt.md` — патч по author voice и system prompt. Статус: `исторический источник`; соответствует `_legacy_web/app/api/_utils/authorVoice.ts`, `_legacy_web/data/author_voice.json`, `_legacy_web/app/api/communicator/v2/dialog/route.ts`. Последнее изменение: `2026-05-01`.
- `docs/tmp_docs/29042026/PATCH_9_phase_prompts_library.md` — патч по библиотеке phase-prompts. Статус: `исторический источник`; соответствует prompt/scenario-слою в `_legacy_web/app/api/_utils/prompts.ts`, `_legacy_web/app/api/_utils/scenarios.ts`, `supabase/seed.sql`. Последнее изменение: `2026-05-01`.

## Карта модулей по коду

| Модуль | Где живёт | Точки входа |
| --- | --- | --- |
| Доступ и тарифы | `modules/access/` | `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/profile.tsx` |
| Авторизация | `modules/auth/` | `app/_layout.tsx`, `app/sign-in.tsx`, `app/onboarding.tsx` |
| Домашний экран и day content | `modules/home/`, `services/dayContentCache.ts`, `services/globalContentClient.ts`, `services/dailyForecastClient.ts` | `app/(tabs)/index.tsx`, `modules/home/useDayContent.ts` |
| Astro-Core | `modules/astro-core/`, `_legacy_web/modules/astro-core/` | `modules/astro-core/index.ts`, `_legacy_web/app/api/astro/natal/route.ts` |
| Daily-Engine | `modules/daily-engine/`, `_legacy_web/modules/daily-engine/` | `modules/daily-engine/index.ts`, `_legacy_web/app/api/astro/daily-forecast/route.ts`, `supabase/functions/daily-forecast/index.ts` |
| Communicator / Orchestrator | `modules/communicator/`, `_legacy_web/app/api/communicator/v2/`, `_legacy_web/app/api/ai/` | `app/(tabs)/index.tsx`, `modules/communicator/ui/Communicator.tsx`, `_legacy_web/app/api/communicator/v2/dialog/route.ts` |
| Calibration | `app/calibration.tsx`, `_legacy_web/app/api/calibration/`, `supabase/functions/auto-calibrate/` | `app/calibration.tsx`, `_legacy_web/app/api/calibration/extract/route.ts`, `_legacy_web/app/api/calibration/transcribe/route.ts`, `supabase/functions/auto-calibrate/index.ts` |
| Каталог и запуск практик | `modules/practices/`, `services/practiceSessions.ts` | `app/(tabs)/practices.tsx`, `modules/practices/ui/PracticeCatalogScreen.tsx`, `modules/practices/ui/launchPractice.ts` |
| Дыхательные практики | `modules/breath/` | `app/breath-coherence.tsx`, `modules/breath/ui/CoherenceBreathScreen.tsx` |
| Biofeedback pipeline | `modules/biofeedback/`, `modules/biofeedback-finger-frame-processor/` | `app/biofeedback-probe.tsx`, `modules/biofeedback/bus/biofeedback-provider.tsx`, `modules/biofeedback/sensors/FingerPpgCameraSource.tsx` |
| Mandala visual runtime | `modules/mandala/` | `app/mandala-sandbox.tsx`, `app/sacred-symbol-stream.tsx`, `app/bindu-succession-lab.tsx` |
| Mandala Sound | `modules/mandala-sound/`, `assets/audio/mandala-sound/` | `modules/mandala-sound/index.ts`, интеграции в `modules/breath/ui/CoherenceBreathScreen.tsx` и `modules/mandala/experiments/SacredSymbolStreamScreen.tsx` |
| Remote Play / TV | `modules/remote-play/` | `app/connect-tv.tsx`, `app/tv-remote.tsx`, `modules/remote-play/RemotePlayProvider.tsx` |
| Геолокация пользователя | `modules/location/` | `modules/location/acquireAndPersistUserCoordinates.ts`, вызов из `modules/home/useDayContent.ts` |
| Startup/bootstrap overlay | `modules/bootstrap/` | `app/_layout.tsx`, `modules/bootstrap/AppStartupProvider.tsx` |
| Shared UI / theme | `modules/ui/` | `modules/ui/theme.ts`, `modules/ui/AppButton.tsx`, `modules/ui/AppText.tsx`, `modules/ui/AppDialog.tsx` |
| Supabase schema и cron/edge | `supabase/migrations/`, `supabase/functions/` | `supabase/README.md`, `supabase/functions/*/index.ts` |

## Соответствие код ↔ документация

| Модуль в коде | Документация | Статус |
| --- | --- | --- |
| `modules/access/` | `modules/access/readme.md`, `docs/planning/access_tiers_navigation_brief.md`, `docs/tmp_docs/02052026/access_tiers_navigation_brief.md`, `docs/tmp_docs/29042026/PATCH_14_free_tier.md` | Есть текущая документация + исторические источники |
| `modules/auth/` | `modules/auth/readme.md` | Есть текущая документация |
| `modules/home/` | `docs/product_logic.md`, `docs/tmp_docs/29042026/PATCH_13_monologue_prompts.md`, `docs/tmp_docs/29042026/PATCH_14_free_tier.md`, `docs/tmp_docs/29042026/PATCH_15_math_level_and_charts.md` | Нет отдельной канонической документации по модулю; только смежные источники |
| `modules/astro-core/` | `docs/tmp_docs/29042026/MODULE_1_AstroCore_TZ.md`, частично `docs/system_structure.md` | Нет текущей канонической документации |
| `modules/daily-engine/` | `docs/tmp_docs/29042026/MODULE_2_DailyEngine_TZ.md`, `docs/tmp_docs/29042026/PATCH_4_engine_parity.md`, частично `docs/tech_stack.md` | Нет текущей канонической документации |
| Calibration (`app/calibration.tsx`, `_legacy_web/app/api/calibration/*`, `supabase/functions/auto-calibrate/*`) | `docs/modules/calibration_and_orchestrator.md`, `docs/tmp_docs/29042026/MODULE_3_Calibration_TZ.md`, `docs/tmp_docs/29042026/PATCH_1_M3_averaging_ratio.md`, `docs/tmp_docs/29042026/PATCH_6_proposal_pending_fix.md`, `docs/tmp_docs/29042026/PATCH_10_insight_engine.md`, `docs/tmp_docs/chakra_states_baseline.json.txt` | Есть текущий общий doc, но calibration разбит по слишком многим историческим источникам |
| `modules/communicator/` и `_legacy_web/app/api/communicator/v2/*` | `modules/communicator/readme.md`, `docs/modules/communicator_roadmap.md`, `docs/modules/calibration_and_orchestrator.md`, `docs/tmp_docs/Коммуникатор.txt`, `docs/tmp_docs/29042026/MODULE_4_AIAssistant_TZ.md`, `docs/tmp_docs/29042026/PATCH_2_*.md`, `PATCH_7_*.md`, `PATCH_8_*.md`, `PATCH_9_*.md`, `PATCH_10_*.md`, `PATCH_11_*.md`, `PATCH_12_*.md`, `PATCH_13_*.md` | Документации много, но она сильно фрагментирована |
| `modules/practices/` | `modules/practices/readme.md`, `docs/planning/practices_module_brief.md`, `docs/planning/assistant_practice_recommendation_brief.md`, `docs/planning/vimeo_asanas_import_brief.md`, `docs/tmp_docs/02052026/*` дубликаты | Есть текущий модульный readme + много плановых дублей |
| `modules/breath/` | `modules/breath/readme.md`, `docs/breath-coherence-pipeline.md`, `docs/testing-mode.md`, `docs/user-diagnostic-json-reception.md`, `docs/tmp_docs/Дыхание/*` | Есть хороший набор документации, но он пересекается с biofeedback docs |
| `modules/biofeedback/` | `modules/biofeedback/readme.md`, `docs/biofeedback-architecture.md`, `docs/biofeedback-parity-contract.md`, `docs/breath-coherence-pipeline.md`, `docs/hrv-rmssd-stress-algorithms.md`, `docs/android-adaptation-notes.md`, `docs/tmp_docs/Мандала/1Снимок экрана 2026-04-09 в 21.53.48.png`, `docs/tmp_docs/Мандала/2Снимок экрана 2026-04-09 в 21.54.12.png` | Есть много документации, но один ключевой файл устарел |
| `modules/biofeedback-finger-frame-processor/` | `docs/android-adaptation-notes.md` | Нет отдельного readme; documented only indirectly |
| `modules/mandala/` | `modules/mandala/readme.md`, `docs/meditation_video_generator_spec.md`, `docs/modules/mandala.md`, `docs/modules/visual_module_map.md`, `docs/modules/bindu_succession_lab.md`, `docs/modules/lotus_bloom_evolution_strategy.md`, `docs/modules/lotus_bloom_evolving_requirements.md`, `docs/modules/meditation_session_dramaturgy.md`, `docs/modules/continuous_ca_research_notes.md`, `docs/tmp_docs/Мандала/*` | Документации много, но она смешивает runtime, R&D и художественные материалы |
| `modules/mandala-sound/` | `modules/mandala-sound/readme.md`, `docs/modules/mandala_sound.md`, `docs/tmp_docs/Мандала/Звук.txt` | Есть текущая документация + исходный исторический текст |
| `modules/remote-play/` | `docs/remote-play/README.md` | Есть текущая документация, но нет module readme |
| `modules/bootstrap/` | нет | `нет документации` |
| `modules/location/` | нет | `нет документации` |
| `modules/ui/` | `docs/design-tokens.md` | Есть только частичная документация по теме, нет module readme |
| `supabase/` | `supabase/README.md`, многие `docs/tmp_docs/29042026/PATCH_*.md` | Есть общий readme, но нет отдельной карты edge functions и миграций по доменам |

### Документация без живого кода или без явного текущего владельца

- `docs/hrv-rmssd-stress-algorithms.md` — опирается на удалённые пути.
- `docs/modules/bindu_succession_visual_spec_v2.md` — художественная спецификация без явного канонического кода-владельца.
- `docs/modules/continuous_ca_research_notes.md` — R&D-заметки, не отдельный текущий модуль.
- `docs/modules/lotus_bloom_evolving_requirements.md` — R&D-слой, не текущий runtime-контракт.
- `docs/modules/meditation_session_dramaturgy.md` — концептуальный материал, не привязан к одному куску кода.
- весь блок `docs/planning/*` — уже не документация текущего состояния, а этап проектирования.
- весь блок `docs/tmp_docs/02052026/*` — дубликаты planning-документов.
- весь блок `docs/tmp_docs/29042026/*` — исторический слой ТЗ и патчей, не каноническая текущая документация.

## Дубли и пересечения

- Тарифы и feature gates описаны одновременно в `modules/access/readme.md`, `docs/planning/access_tiers_navigation_brief.md` и `docs/tmp_docs/02052026/access_tiers_navigation_brief.md`. Канонический слой должен остаться один: `modules/access/readme.md`.
- Каталог практик и запуск практик описаны одновременно в `modules/practices/readme.md`, `docs/planning/practices_module_brief.md`, `docs/planning/assistant_practice_recommendation_brief.md`, `docs/planning/vimeo_asanas_import_brief.md` и их дубликатах в `docs/tmp_docs/02052026/*`.
- Calibration / orchestrator / assistant размазаны между `docs/modules/calibration_and_orchestrator.md`, `modules/communicator/readme.md`, `docs/modules/communicator_roadmap.md`, `docs/tmp_docs/Коммуникатор.txt`, `docs/tmp_docs/29042026/MODULE_3_Calibration_TZ.md`, `docs/tmp_docs/29042026/MODULE_4_AIAssistant_TZ.md` и патчами `PATCH_1`, `PATCH_2`, `PATCH_6`-`PATCH_13`.
- Biofeedback и дыхательные метрики описаны сразу в `modules/biofeedback/readme.md`, `modules/breath/readme.md`, `docs/biofeedback-architecture.md`, `docs/biofeedback-parity-contract.md`, `docs/breath-coherence-pipeline.md`, `docs/hrv-rmssd-stress-algorithms.md`, а также в дополнительных материалах `docs/tmp_docs/Дыхание/Когерентное дыхание.pdf` и двух PNG-скриншотах в `docs/tmp_docs/Мандала/`.
- Мандала описана сразу на трёх уровнях: канонический runtime (`modules/mandala/readme.md`, `docs/meditation_video_generator_spec.md`), visual map (`docs/modules/visual_module_map.md`) и R&D/художественные спецификации (`docs/modules/bindu_succession_lab.md`, `docs/modules/bindu_succession_visual_spec_v2.md`, `docs/modules/lotus_bloom_evolution_strategy.md`, `docs/modules/lotus_bloom_evolving_requirements.md`, `docs/modules/meditation_session_dramaturgy.md`, `docs/modules/continuous_ca_research_notes.md`, `docs/tmp_docs/Мандала/*`).
- Mandala Sound дублируется в `modules/mandala-sound/readme.md`, `docs/modules/mandala_sound.md` и историческом `docs/tmp_docs/Мандала/Звук.txt`.
- `docs/system_structure.md`, `docs/tech_stack.md` и `docs/documentation_standard.md` частично повторяют друг друга в части слоёв репозитория и правил модульной документации.
- В `docs/tmp_docs/Мандала/` лежат два почти одинаково названных файла: `Мандала_устаревший.txt` и `Мандала_устаревший.txt`; это отдельный дубль файлового источника.

### Противоречия между файлами

- `docs/hrv-rmssd-stress-algorithms.md` описывает старый контур через `modules/biofeedback/core/finger-analysis.ts`, тогда как `docs/biofeedback-architecture.md` и `modules/biofeedback/readme.md` описывают новый pipeline через `modules/biofeedback/bus/biofeedback-pipeline.ts`.
- `docs/system_structure.md` и `docs/documentation_standard.md` требуют readme на каждый модуль, но в текущем дереве `modules/*` readme отсутствует у `modules/astro-core`, `modules/daily-engine`, `modules/home`, `modules/location`, `modules/bootstrap`, `modules/remote-play`, `modules/ui`, `modules/biofeedback-finger-frame-processor`.
- `docs/meditation_video_generator_spec.md` фиксирует звуковой движок как будущий контракт первой фазы, а `modules/mandala-sound/readme.md` и `docs/modules/mandala_sound.md` уже описывают реализованный V1.
- `docs/product_logic.md` описывает крайне узкий набор практик (`Вспышка`, `Подзарядка`), тогда как текущий каталог практик включает дыхательные техники, медитации и асаны через `modules/practices/*` и `modules/breath/core/practices.ts`.

## Расхождения с кодом

- `docs/hrv-rmssd-stress-algorithms.md` ссылается на отсутствующие `modules/biofeedback/core/finger-analysis.ts` и `modules/biofeedback/core/mandala-adapter.ts`; в текущем коде им соответствуют `modules/biofeedback/bus/biofeedback-pipeline.ts` и `modules/biofeedback/adapters/MandalaBioFrameAdapter.ts`.
- `docs/system_structure.md` перечисляет в каталоге текущих модулей только `COMMUNICATOR` и `MANDALA`, хотя фактически активны ещё `access`, `auth`, `home`, `practices`, `breath`, `biofeedback`, `remote-play`, `astro-core`, `daily-engine`, `location`, `bootstrap`, `ui`, `mandala-sound`, `biofeedback-finger-frame-processor`.
- `docs/documentation_standard.md` описывает стандарт как уже действующий, но фактически он не соблюдён для половины модулей из `modules/*`.
- `docs/meditation_video_generator_spec.md` отстаёт от кода по аудио: отдельно реализован `modules/mandala-sound/*`, а в документе это ещё подаётся как «будущий контракт».
- `docs/tech_stack.md` описывает сервер как `_legacy_web`-слой на Vercel, но текущий runtime уже дополнен `supabase/functions/auto-calibrate/index.ts`, `supabase/functions/daily-forecast/index.ts`, `supabase/functions/precompute-daily-forecasts/index.ts`, `supabase/functions/precompute-global-recommendations/index.ts`, `supabase/functions/cleanup-expired-proposals/index.ts`.
- `docs/product_logic.md` не отражает текущий продуктовый доступ из `modules/access/core/features.ts` и не покрывает Remote Play, каталоги асан, практики через ассистента и home/day content контур.
- `docs/modules/calibration_and_orchestrator.md` не покрывает фактический экран `app/calibration.tsx` и автоматический cron-контур `supabase/functions/auto-calibrate/index.ts`; документ описывает только часть backend story.

## Белые пятна

- Нет канонической текущей документации для `modules/astro-core/`; есть только историческое ТЗ `docs/tmp_docs/29042026/MODULE_1_AstroCore_TZ.md`.
- Нет канонической текущей документации для `modules/daily-engine/`; есть только историческое ТЗ `docs/tmp_docs/29042026/MODULE_2_DailyEngine_TZ.md` и патч `docs/tmp_docs/29042026/PATCH_4_engine_parity.md`.
- Нет отдельной документации для `modules/home/`, хотя это один из центральных пользовательских модулей: `app/(tabs)/index.tsx`, `modules/home/useDayContent.ts`, `modules/home/ui/*`.
- Нет документации для `modules/bootstrap/AppStartupProvider.tsx`, хотя стартовый overlay и bootstrap фаз важны для UX и диагностики.
- Нет документации для `modules/location/acquireAndPersistUserCoordinates.ts`, хотя геолокация влияет на `useDayContent` и построение прогнозов.
- Нет документации для `modules/ui/` как модуля; `docs/design-tokens.md` покрывает только тему, но не public API `AppButton`, `AppText`, `AppDialog`, `theme.ts`.
- Нет отдельной документации для `modules/biofeedback-finger-frame-processor/`; информация о нём размазана между кодом и `docs/android-adaptation-notes.md`.
- Нет карты серверных API-эндпоинтов в `_legacy_web/app/api/*`; они описаны фрагментарно по доменам, но нет одного канонического документа.
- Нет карты Edge Functions и cron-процессов в `supabase/functions/*`; `supabase/README.md` описывает часть, но не раскладывает функции по доменным модулям и зависимостям от кода.
- Нет описания того, как связаны `modules/home/useDayContent.ts`, `_legacy_web/app/api/astro/daily-forecast/route.ts`, `_legacy_web/app/api/ai/global-content/route.ts`, `_legacy_web/app/api/ai/monologue/route.ts`, `supabase/functions/daily-forecast/index.ts`; это важный эксплуатационный контур, но он нигде не собран целиком.

## Предложение по перегруппировке

- Свести текущие канонические документы к правилу «один модуль — один основной источник», а всё из `docs/tmp_docs/` оставить как архивный слой требований.
- Для `astro-core` логически объединить `docs/tmp_docs/29042026/MODULE_1_AstroCore_TZ.md` с фактическим кодом `modules/astro-core/*` в новый канонический модульный doc рядом с кодом.
- Для `daily-engine` объединить `docs/tmp_docs/29042026/MODULE_2_DailyEngine_TZ.md` и `docs/tmp_docs/29042026/PATCH_4_engine_parity.md` в один актуальный doc по `modules/daily-engine/*`, `_legacy_web/app/api/astro/daily-forecast/route.ts` и `supabase/functions/daily-forecast/index.ts`.
- Для calibration/orchestrator объединить `docs/modules/calibration_and_orchestrator.md`, `docs/tmp_docs/29042026/MODULE_3_Calibration_TZ.md`, `docs/tmp_docs/29042026/PATCH_1_M3_averaging_ratio.md`, `docs/tmp_docs/29042026/PATCH_6_proposal_pending_fix.md`, `docs/tmp_docs/29042026/PATCH_10_insight_engine.md` в один доменный набор: `calibration`, `auto-calibrate`, `dialog orchestration`.
- Для communicator/assistant объединить `modules/communicator/readme.md`, `docs/modules/communicator_roadmap.md`, `docs/tmp_docs/Коммуникатор.txt`, `docs/tmp_docs/29042026/MODULE_4_AIAssistant_TZ.md` и патчи `PATCH_2`, `PATCH_7`, `PATCH_8`, `PATCH_9`, `PATCH_11`, `PATCH_12`, `PATCH_13` в один канонический doc по RN-клиенту + server orchestrator + prompt/scenario layer.
- Для practices/access объединить planning-ветку `docs/planning/access_tiers_navigation_brief.md`, `docs/planning/practices_module_brief.md`, `docs/planning/assistant_practice_recommendation_brief.md`, `docs/planning/vimeo_asanas_import_brief.md` и удалить из активного контура их дубликаты в `docs/tmp_docs/02052026/*`. Канонические владельцы: `modules/access/readme.md` и `modules/practices/readme.md`.
- Для biofeedback оставить каноническими `modules/biofeedback/readme.md`, `docs/biofeedback-architecture.md`, `docs/biofeedback-parity-contract.md`; `docs/hrv-rmssd-stress-algorithms.md` перевести в архивный статус или удалить после переноса полезных деталей.
- Для breath оставить каноническими `modules/breath/readme.md`, `docs/breath-coherence-pipeline.md`, `docs/testing-mode.md`, `docs/user-diagnostic-json-reception.md`; допматериалы из `docs/tmp_docs/Дыхание/*` использовать как reference-appendix, а не как отдельный слой документации.
- Для mandala разделить документы на три корзины: `runtime` (`modules/mandala/readme.md`, `docs/meditation_video_generator_spec.md`, `docs/modules/mandala.md`), `visual map` (`docs/modules/visual_module_map.md`), `R&D archive` (`docs/modules/bindu_succession_visual_spec_v2.md`, `docs/modules/continuous_ca_research_notes.md`, `docs/modules/lotus_bloom_evolution_strategy.md`, `docs/modules/lotus_bloom_evolving_requirements.md`, `docs/modules/meditation_session_dramaturgy.md`, `docs/tmp_docs/Мандала/*`).
- Для mandala sound объединить `modules/mandala-sound/readme.md`, `docs/modules/mandala_sound.md` и `docs/tmp_docs/Мандала/Звук.txt` в один канонический doc модуля и один архивный источник.
- Для платформенно-инфраструктурного слоя выделить отдельные канонические docs по `home/day content`, `server API map`, `supabase functions/cron`, `bootstrap/startup`, `location`, `ui`.

## Итог

Главная проблема не в нехватке материалов, а в том, что текущая документация смешивает четыре разных типа источников:

1. канонические модульные контракты;
2. архитектурные справки;
3. R&D/художественные заметки;
4. исторические ТЗ и патчи.

Для дальнейшей работы ИИ-моделей это создаёт ложные «центры истины»: особенно вокруг `biofeedback`, `communicator/orchestrator`, `mandala` и `practices/access`.

Самые критичные шаги на следующем этапе:

- зафиксировать канонические текущие документы для `astro-core`, `daily-engine`, `home`, `bootstrap`, `location`, `ui`, `server API`, `supabase/functions`;
- перевести planning/tmp_docs в явный архивный слой;
- убрать из активного контура явно устаревший `docs/hrv-rmssd-stress-algorithms.md`;
- слить патч-серию `docs/tmp_docs/29042026/*` обратно в текущие доменные документы.
