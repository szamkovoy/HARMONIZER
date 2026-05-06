---

## id: 04_workspace/open_questions
title: Open Questions
version: 1.3
updated: 2026-05-07
depends_on: [00_index/CHANGELOG]
code_refs: []

## `bindu`

- После переноса источников в `docs/05_archive/migrated/bindu/` в репозитории остаются **устаревшие пути** в инвентарных файлах (например `docs/_audit.md`), где ещё перечислены `docs/meditation_video_generator_spec.md`, `docs/modules/bindu_succession_lab.md`, `docs/modules/visual_module_map.md`. Нужна отдельная правка аудита или ссылка на новый канон `docs/02_modules/bindu/`*, вне scope одной миграции модуля.

## `infra`

- Файлы `docs/tmp_docs/29042026/PATCH_5_RLS_tightening.md` и `PATCH_11_whisper_quality.md` перенесены в `docs/05_archive/migrated/infra/`. В `docs/_audit.md` и в `docs/tmp_docs/29042026/00_OPTIMIZATION_PLAN.md` остаются ссылки на старые пути — обновить при следующем проходе аудита или архивации всей серии `29042026`.

## `astro` / `daily_forecast` (cache parity)

- **Edge-функция daily-forecast использует устаревший fallback cacheValidUntil = now + 24h**  
  **Контекст:** основной путь (`modules/daily-engine/computeDailyForecast.ts`) задаёт `cacheValidUntil` через `endOfForecastDateUtc` — конец календарного дня прогноза в timezone пользователя. В `supabase/functions/daily-forecast/index.ts` для fallback-ответа используется `new Date(Date.now() + 24 * 60 * 60 * 1000)`, без привязки к локальному дню; это тот же класс расхождений с timezone-aware срезом кэша, который PATCH_3 адресовал для `/api/calibration/extract` и локальной даты.  
  **Проявление:** краевые случаи около полуночи UTC, неконсистентный TTL кэша в зависимости от того, прошёл ли расчёт через Next.js API или Edge.  
  **Предложение:** parity-fix в Edge (та же формула, что в основном пути) или вынести расчёт `cacheValidUntil` в общий модуль, импортируемый Node и Deno (по духу PATCH_4 для M2). См. также `docs/02_modules/astro/caching_strategy.md`.

## `biofeedback`

- **updateHrvMetrics не вызывается из PPG-пайплайна**  
  **Контекст:** функция `updateHrvMetrics` в `modules/biofeedback/core/metrics.ts` существует и документирована как единая точка RMSSD/Баевского для скользящего окна, но основной путь `BiofeedbackPipeline` / камера её не вызывает (см. `docs/02_modules/biofeedback/history.md`).  
  **Возможные причины:** (а) мёртвый код после итерации архитектуры; (б) запланированная интеграция, не доведённая до конца; (в) использование на другом пути, не отслеженном при миграции документации.  
  **Действие:** при следующей работе с модулем biofeedback проверить фактические вызовы (`grep`/runtime), затем удалить, подключить к пайплайну или явно задокументировать как намеренный legacy.

## Общее

- На момент создания скелета дополнительных записей не требовалось; новые вопросы добавлять сюда по мере миграции остальных модулей.