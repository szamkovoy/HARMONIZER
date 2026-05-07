---

## id: 04_workspace/open_questions
title: Open Questions
version: 1.7
updated: 2026-05-07
depends_on: [00_index/CHANGELOG]
code_refs: []

## `bindu`

- После переноса источников в `docs/05_archive/migrated/bindu/` в репозитории остаются **устаревшие пути** в инвентарных файлах (например `docs/_audit.md`), где ещё перечислены `docs/meditation_video_generator_spec.md`, `docs/modules/bindu_succession_lab.md`, `docs/modules/visual_module_map.md`. Нужна отдельная правка аудита или ссылка на новый канон `docs/02_modules/bindu/`*, вне scope одной миграции модуля.

## `audio` / `bindu` (пакетные границы)

- **Встречные импорты `mandala-sound` ↔ `modules/mandala`**  
  **Контекст:** `mandala-sound/core/sync.ts` импортирует `buildAudioContract` и типы из `modules/mandala/core/`; часть файлов в `modules/mandala/experiments/` импортирует `MandalaSoundProvider` / типы из `mandala-sound`. Такт и снижение частот (таймлайн) при этом сосредоточены в `MandalaSoundProvider`, а не в канвасе мандалы.  
  **Проявление:** жёсткая сцепка релизов двух пакетов; риск неявного цикла при реорганизации barrel-экспортов или выносе кода в общий пакет.  
  **Действие:** при следующей крупной рефакторизации — либо вынести общий контракт в нейтральный слой (отдельный пакет/файл без UI), либо зафиксировать ADR с правилом «истина в `mandala/core/bio.ts`», допустимым направлением импортов и исключениями для `experiments/`.

## `infra`

- Файлы `docs/tmp_docs/29042026/PATCH_5_RLS_tightening.md` и `PATCH_11_whisper_quality.md` перенесены в `docs/05_archive/migrated/infra/`. В `docs/_audit.md` и в `docs/tmp_docs/29042026/00_OPTIMIZATION_PLAN.md` остаются ссылки на старые пути — обновить при следующем проходе аудита или архивации всей серии `29042026`.

## `astro` / `daily_forecast` (cache parity)

- **Edge-функция daily-forecast использует устаревший fallback cacheValidUntil = now + 24h**  
  **Контекст:** основной путь (`modules/daily-engine/computeDailyForecast.ts`) задаёт `cacheValidUntil` через `endOfForecastDateUtc` — конец календарного дня прогноза в timezone пользователя. В `supabase/functions/daily-forecast/index.ts` для fallback-ответа используется `new Date(Date.now() + 24 * 60 * 60 * 1000)`, без привязки к локальному дню; это тот же класс расхождений с timezone-aware срезом кэша, который PATCH_3 адресовал для `/api/calibration/extract` и локальной даты (исторический текст: `docs/05_archive/migrated/daily_forecast/PATCH_3_forecast_cache_timezone.md`).  
  **Проявление:** краевые случаи около полуночи UTC, неконсистентный TTL кэша в зависимости от того, прошёл ли расчёт через Next.js API или Edge.  
  **Предложение:** parity-fix в Edge (та же формула, что в основном пути) или вынести расчёт `cacheValidUntil` в общий модуль, импортируемый Node и Deno (по духу PATCH_4 для M2). См. также `docs/02_modules/astro/caching_strategy.md`.

- **Parity-тест Node↔Deno покрывает не весь прогноз**  
  **Контекст:** `supabase/functions/_shared/daily-engine-parity.test.ts` сравнивает `effectiveNatalParams`, `computeActivation`, `computeImportance` между `modules/daily-engine` и `_shared/dailyForecast.ts`.  
  **Пробел:** нет автоматической проверки полной цепочки в духе «одинаковый `DailyForecast`» включая `rankPlanets` / `chooseFinalPlanet`, синтетические окна и различия провайдеров транзитов между Next и Edge.  
  **Действие:** при существенных правках M2 расширить golden-fixtures / интеграционный тест или явно принять ручной регрессионный чеклист.

## `daily_forecast`

- **recentPlanetsOfDay не записывается клиентом — серверная логика повторов планеты дня неактивна**  
  **Контекст:** ТЗ MODULE_2 (см. архив `docs/05_archive/migrated/astrology/`) описывает стек двух последних планет дня для предотвращения повторов 3+ дня подряд. Сервер (`_legacy_web/app/api/astro/daily-forecast/route.ts`) читает `user_settings.preferences.recentPlanetsOfDay`, и `chooseFinalPlanet` использует его для альтернативного выбора. Однако клиент (`useDayContent` → `fetchDailyForecast`) не передаёт `recentPlanetsOfDay` в теле запроса и не записывает в `preferences` после показа дня. Стек на практике всегда пуст; альтернативная ветка `chooseFinalPlanet` по «недавности» не активируется.  
  **Проявление:** пользователь может три дня подряд получать одну и ту же планету дня (например Сатурн при сильно активном Сатурне в натале), и «альтернативный выбор» с пояснительным текстом не сработает.  
  **Действие:** при следующей работе с `daily_forecast` — либо реализовать запись стека (после показа forecast записывать в `user_settings`), либо удалить серверную логику стека как мёртвую (если продуктово решено, что повторы — норма). Зафиксировать решение явно.

## `subscription`

- **users.membership_tier: БД допускает только free/premium, клиент готов к oracle/practitioner/master**  
  **Контекст:** `profileTier` в `modules/access/core/access.tsx` обрабатывает строки `oracle` / `practitioner` / `master`, но constraint миграции `supabase/migrations/20260501193000_free_tier_global_content.sql` допускает только `check (membership_tier in ('free','premium'))`. Прямая запись `oracle` в БД даст ошибку constraint.  
  **Проявление:** при выкатке полной модели тарифов (оплата или ручной upgrade) первая запись нового tier упрётся в constraint.  
  **Действие:** при следующей правке тарифов — либо миграция, расширяющая/снимающая constraint, либо явная политика «multitier только в коде, в БД пока free/premium» с документированным маппингом.

- **Условие «premium ИЛИ (free И trial не истёк)» дублируется в нескольких местах**  
  **Контекст:** правило эффективного премиум-доступа повторяется в `getEffectiveAccess` / trial-ветке (`modules/access/core/access.tsx`), в `hasPremiumAccess` / `accessModeFor` (`modules/home/useDayContent.ts`, `services/globalContentClient.ts`), в `hasPremiumLlmAccess` (`_legacy_web/app/api/_utils/userModelTier.ts`) и в маршрутах `global-content`, `communicator/v2/dialog`, `greeting`, `recommendation-text`.  
  **Проявление:** изменение правил (продление trial, льготы) требует синхронных правок в 3–4 местах.  
  **Действие:** при серьёзной работе с subscription вынести единую функцию уровня `hasEffectivePremium` / `canRunPremiumLlm`, доступную клиенту и серверу; до рефакторинга при правке одной точки проверять остальные.

## `biofeedback`

- **updateHrvMetrics не вызывается из PPG-пайплайна**  
  **Контекст:** функция `updateHrvMetrics` в `modules/biofeedback/core/metrics.ts` существует и документирована как единая точка RMSSD/Баевского для скользящего окна, но основной путь `BiofeedbackPipeline` / камера её не вызывает (см. `docs/02_modules/biofeedback/history.md`).  
  **Возможные причины:** (а) мёртвый код после итерации архитектуры; (б) запланированная интеграция, не доведённая до конца; (в) использование на другом пути, не отслеженном при миграции документации.  
  **Действие:** при следующей работе с модулем biofeedback проверить фактические вызовы (`grep`/runtime), затем удалить, подключить к пайплайну или явно задокументировать как намеренный legacy.

## Общее

- На момент создания скелета дополнительных записей не требовалось; новые вопросы добавлять сюда по мере миграции остальных модулей.