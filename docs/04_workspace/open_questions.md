---

## id: 04_workspace/open_questions

title: Open Questions
version: 1.23
updated: 2026-05-28
depends_on: [00_index/CHANGELOG]
code_refs: []

## `webinars`

- Модуль **не реализован**; продуктовое решение (вкладка, community, расписание) и реализация ожидаются.

## `author_presence`

- Модуль **не реализован**; продуктовое решение (тарифы, UI сторис/баннеров поверх существующих таблиц) и реализация ожидаются.

## `communicator`

- **Очередь `pending-greeting` без потребителя на главном экране**  
**Контекст:** `modules/breath/ui/CoherenceBreathScreen.tsx` вызывает `enqueueCommunicatorGreeting()` и затем `router.replace("/")`, ожидая, что главный экран смонтирует `Communicator` с `autoSendInitialMessage` / переопределением `systemPrompt` из очереди. В `app/(tabs)/index.tsx` нет вызова `consumeCommunicatorGreeting()` и передачи результата в `<Communicator />`.  
**Проявление:** сценарий «Обсудить результаты» из дыхания не запускает автоматическую отправку первого сообщения в ассистенте.  
**Действие:** либо на home при открытии/монтировании оверлея читать очередь и прокидывать в `Communicator`, либо убрать/заменить мёртвый путь.
- **Хрупкость разбора SSE на клиенте**  
**Контекст:** `parseSseBlock` / `handleSseEvent` в `services/communicator-client.ts` завязаны на фиксированные имена событий и JSON-форму полей.  
**Проявление:** несовпадение с сервером (имя события, вложенность `data`) даст тихую потерю чанков или пустой ответ.  
**Действие:** при изменении контракта SSE на стороне `assistant` — синхронно обновлять клиент и дымовой тест end-to-end.

## `assistant`

- **Locale-aware baseline применён только для новых life spheres, не для chakra states**  
**Контекст:** HARMONIZER v2 добавил `_legacy_web/data/life_spheres_baseline/{ru,en}.json` и loader `lifeSpheresBaseline.ts`, но существующий `_legacy_web/data/chakra_states_baseline.json` остаётся единым файлом без locale-dispatch.  
**Проявление:** новый prompt v5 уже может быть локализован по сферам жизни, тогда как chakra-state baseline по-прежнему монолитный и не следует новому паттерну.  
**Действие:** при следующей работе с ассистентом/локализацией решить, нужно ли переводить `chakra_states_baseline` на тот же `ru/en + loader` шаблон или оставить его intentionally single-source.
- **Два URL одного диалога и условный выбор на клиенте**  
**Контекст:** `sendDialogMessage` (`services/communicator-client.ts`) использует `getAiDialogUrl()` только если передан `**scenario_id`**; иначе запрос идёт на `**/api/communicator/v2/dialog**` (помечен deprecated в логах сервера). Реализация совпадает через реэкспорт, но продолжается техдолг по единому каноническому пути и по обязательной передаче `scenario_id` для всех новых клиентов.  
**Действие:** при рефакторинге communicator — всегда бить в `/api/ai/dialog` или явно документировать исключения.
- **Тема дня для практики vs топ-3 для утреннего монолога**  
**Контекст:** `morning_recommendation` собирает три лепестка по `**ranked_planets` / importance** (`topPetals`), а `**choosePractice`** в `practiceSelection.ts` берёт чакру из `**planet_of_the_day**`. Это сознательное расхождение или временная асимметрия продукта — в коде не сведено.  
**Действие:** решение заказчика: выровнять выбор чакры для стека практик с топ-1 лепестком, либо зафиксировать продуктовую модель «утро про три темы, практика про планету дня».
- **Explicit dialog cache остаётся process-local**  
**Контекст:** в dialog v3 `ensureDialogCache(...)` в `_legacy_web/app/api/_utils/gemini.ts` хранит `cache.name` в in-memory TTL map; внешнего Redis/KV в проекте не найдено.  
**Проявление:** на одном инстансе Vercel возможны cache hit по одному `conversationId + historyHash`, но между cold start / разными инстансами reuse не гарантирован; реальная экономия токенов может плавать.  
**Действие:** при следующем заходе в infra/assistant решить, нужен ли shared cache store (Redis/KV) или текущий best-effort режим достаточно хорош для v3.
- **Для `planned_events` нет отдельного cleanup job вне интерактивного dialog path**  
**Контекст:** HARMONIZER v2 протухшие запланированные события сейчас закрывает через `expireStalePlannedEvents()` во время загрузки day-context для очередного диалога. Отдельного cron/worker, который чистит хвосты без входа пользователя в чат, нет.  
**Проявление:** пользователь, который перестал открывать ассистента, может оставить stale `planned_events` до следующего dialog request; отчёты и вспомогательные выборки должны учитывать это best-effort поведение.  
**Действие:** при следующем инфраструктурном проходе решить, нужен ли scheduled cleanup / background rebuild для `planned_events` и `daily_matrices`.
- **`outcome_cells` для summarized events могут уезжать в слишком общие сферы**  
**Контекст:** delayed reconcile в `planningReconciliation.ts` больше не смешивает planning anti-duplicate и summary-classification в одном JSON-pass: summary-кандидаты сначала нормализуются в compact `normalized_outcome`, затем отдельным low-cost classifier prompt-ом (`getModelByHint("low")` + `life_spheres_baseline` + `chakra_baselines`) получают `outcome_cells`. Rule-based post-validation по sphere hints по-прежнему отсутствует.  
**Проявление:** события вроде обсуждения контракта могут неожиданно получать сферу 7 («смысл и вклад»), а культурный/релаксационный эпизод — сферу 1 («тело и здоровье»), если модель цепляется за косвенные слова вроде `спалось`, `ценности`, `голос`, а не за основной домен события. Пользователю это выглядит как «фонящий» выбор столбцов при в целом разумной архитектуре матрицы.  
**Действие:** при следующем заходе в assistant/life-matrix решить, достаточно ли двухшаговой low-cost цепочки, или нужно усилить classifier prompt, поднять модель для classification, добавить rule-based post-validation по sphere hints или завести golden-fixtures для спорных доменов (`контракты`, `искусство`, `сон после события`).

## `bindu`

- После переноса источников в `docs/05_archive/migrated/bindu/` в репозитории остаются **устаревшие пути** в инвентарных файлах (например `docs/_audit.md`), где ещё перечислены `docs/meditation_video_generator_spec.md`, `docs/modules/bindu_succession_lab.md`, `docs/modules/visual_module_map.md`. Нужна отдельная правка аудита или ссылка на новый канон `docs/02_modules/bindu/`*, вне scope одной миграции модуля.

## `audio` / `bindu` (пакетные границы)

- **Встречные импорты `mandala-sound` ↔ `modules/mandala`**  
**Контекст:** `mandala-sound/core/sync.ts` импортирует `buildAudioContract` и типы из `modules/mandala/core/`; часть файлов в `modules/mandala/experiments/` импортирует `MandalaSoundProvider` / типы из `mandala-sound`. Такт и снижение частот (таймлайн) при этом сосредоточены в `MandalaSoundProvider`, а не в канвасе мандалы.  
**Проявление:** жёсткая сцепка релизов двух пакетов; риск неявного цикла при реорганизации barrel-экспортов или выносе кода в общий пакет.  
**Действие:** при следующей крупной рефакторизации — либо вынести общий контракт в нейтральный слой (отдельный пакет/файл без UI), либо зафиксировать ADR с правилом «истина в `mandala/core/bio.ts`», допустимым направлением импортов и исключениями для `experiments/`.

## `infra`

- Файлы `docs/tmp_docs/29042026/PATCH_5_RLS_tightening.md` и `PATCH_11_whisper_quality.md` перенесены в `docs/05_archive/migrated/infra/`. В `docs/_audit.md` и в `docs/tmp_docs/29042026/00_OPTIMIZATION_PLAN.md` остаются ссылки на старые пути — обновить при следующем проходе аудита или архивации всей серии `29042026`.
- **Локальный запуск Supabase CLI не подтверждён в этом workspace**  
**Контекст:** при попытке применить миграцию `20260511161000_dialog_system_v3.sql` локально команды `npx supabase status` / `npx supabase db push --local` повторно завершались ошибкой ещё на стадии `npx`-подтягивания CLI.  
**Проявление:** код и SQL уже в репозитории, но локальная проверка prompt-миграции в dockerized Supabase не завершена.  
**Действие:** при следующем инфраструктурном проходе решить проблему с локальным `supabase` CLI или перейти на заранее установленный бинарь/CI-путь для проверки миграций.

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

## `profile`

- **`practice_sessions` — запись при завершении (решено 2026-05-21)**  
**Контекст:** `recordPracticeSession` вызывается при **завершении** сессии (асана — «Завершить практику», дыхание — выбор настроения после таймера, медитация — `completePractice`). Запись **не** создаётся при рекомендации ассистентом или при открытии карточки без завершения.  
**Решение владельца:** модель «только завершённые практики попадают в отчёт» **устраивает**, менять на insert при «Начать практику» **не нужно**.  
**Инвариант:** отчёт `practice-by-chakra` и `user_daily_stats` отражают только сессии с `ended_at IS NOT NULL`.
- **Перегрев iPhone на экране профиля в dev-client**  
**Контекст:** владелец (iPhone 14, `expo start --dev-client -c`, тариф «Мастер») сообщил сильный нагрев при открытии профиля и переключении селекторов периода (2026-05-21). Статический аудит `ProfileReports.tsx` / `profile.tsx`: бесконечных `useEffect`, polling, `setInterval`, SVG-анимаций не найдено; каждый селектор вызывает один fetch на смену периода.  
**Проявление:** возможный baseline dev-режима (Metro, LogBox, React dev overhead) без воспроизведения на Release-сборке.  
**Действие:** владельцу сравнить тот же сценарий на `expo run:ios --configuration Release`; при сохранении перегрева в prod — профилировать React DevTools / Instruments.

## `practices`

- **Воспроизведение видео асан (Vimeo) в мобильном клиенте**  
**Контекст:** `app/asana-practice.tsx` явно сообщает, что локальный Vimeo-плеер отключён из‑за отсутствия native WebView в текущем dev-client; показываются метаданные и кнопка завершения с записью сессии.  
**Проявление:** пользователь не смотрит видео внутри приложения до появления WebView, встроенного Vimeo SDK или сценария Remote Play на внешнем экране.  
**Действие:** продуктово зафиксировать целевой сценарий (WebView vs Remote Play vs гибрид) и реализовать; до этого ограничение остаётся в `spec.md` §5.
- **Биометрия для медитации «Вспышка»**  
**Контекст:** дыхательная практика пишет итоговые `**metrics`** из PPG; `**SacredSymbolStreamScreen`** сохраняет `**metrics: {}**` и не подключает biofeedback.  
**Вопрос:** нужен ли в следующих версиях тот же класс метрик, что и для дыхания, или медитация намеренно остаётся «лёгкой» без пульса.  
**Действие:** решение заказчика; при «да» — проектирование UX (палец на камере во время медитации) и единый контракт `practice_sessions.metrics`.
- `**user_practice_preferences` и round-robin дыхания (breath)**  
**Контекст:** триггер `practice_sessions_update_prefs` в `supabase/migrations/20260429051600_calibration_dialogue_orchestrator.sql` обновляет `user_practice_preferences` только при **непустом `practice_id`**. Клиент `recordPracticeSession` (`services/practiceSessions.ts`) передаёт UUID `**practice_id` только для асан**; для **breath** и **meditation** в сессию уходит в основном `**practice_slug`**, без UUID.**  
**Проявление: для дыхательных сессий строки в `user_practice_preferences` не накапливаются через этот триггер; при рекомендации breath ассистенту не хватает опоры на «недавно выполненные» UUID для round-robin — одна и та же дыхательная практика может предлагаться несколько дней подряд, хотя продуктово ожидается цикл по каталогу.**  
**Продуктовое намерение: асаны — round-robin по полному каталогу (~~200) с окном 15 дней (асана не чаще раза в 15 дней). Дыхание — та же идея round-robin: сейчас 7 типов → естественное окно **~~7 дней** (каждая практика примерно раз в неделю); при росте числа дыхательных практик окно увеличится автоматически с размером каталога — смысл: не предлагать повтор, пока не прошли остальные в круге. Медитация — сейчас одна практика «Вспышка», повтор каждый раз намеренно, персонализация не нужна; когда медитаций станет больше — тогда цикл по кругу. Медитацию в рамках этой задачи не меняем.**  
**Действие при следующей работе с `practices` / `assistant`: явно выбрать и задокументировать в коде один из путей: (а) передавать UUID `practice_id` для breath (строки в `practices` с `kind = 'breath'` — при отсутствии строк добавить миграцию/сид), либо (б) расширить триггер/схему так, чтобы для breath надёжно велась история по `**practice_slug`**. После выбора — проверить согласованность с `practiceSelection.ts` и `@shared/selector`.
- **Round-robin асан: 15-дневное окно как продуктовое правило**  
**Контекст:** в `docs/02_modules/practices/spec.md` и `history.md` **не зафиксировано** продуктовое правило «асана не чаще чем раз в 15 дней, полный круг по каталогу». В коде серверного выбора константа `**recentStackLimitForKind('yoga') === 15`** в `_legacy_web/shared_core/selector.ts` задаёт размер окна недавних ID для йоги и **соответствует** заявленному намерению (не произвольное число).  
**Проявление:** при рефакторинге селектора или миграции каталога легко сломать или «упростить» окно, не понимая продуктовой цели.  
**Действие:** при следующем изменении `selector.ts` / `practiceSelection.ts` сверять поведение с этим пунктом; при желании дублировать краткую отсылку в `practices/spec.md` §5 (без расширения scope текущей задачи — сейчас источник истины для намерения здесь).

## `biofeedback`

- **updateHrvMetrics не вызывается из PPG-пайплайна**  
**Контекст:** функция `updateHrvMetrics` в `modules/biofeedback/core/metrics.ts` существует и документирована как единая точка RMSSD/Баевского для скользящего окна, но основной путь `BiofeedbackPipeline` / камера её не вызывает (см. `docs/02_modules/biofeedback/history.md`).  
**Возможные причины:** (а) мёртвый код после итерации архитектуры; (б) запланированная интеграция, не доведённая до конца; (в) использование на другом пути, не отслеженном при миграции документации.  
**Действие:** при следующей работе с модулем biofeedback проверить фактические вызовы (`grep`/runtime), затем удалить, подключить к пайплайну или явно задокументировать как намеренный legacy.

## Общее

- **Техдолг тестов (не блокер):** `npx tsc --noEmit` в `_legacy_web` даёт 3 ошибки в `app/api/communicator/v2/dialog/practiceSelection.test.ts` (TS2783 ×2 строки 33–34, TS2339 строка 308). Ошибки ПРЕДсуществующие (не регресс HARMONIZER v2 / патча C.4), только в тест-файле, `next build` их фильтрует (runTypeCheck игнорирует `*.test.ts`), в прод-бандл не попадают. Безопасно для продакшена. Чистый фикс — ~3 строки в тесте (деструктуризация input в `breath()`; сужение типа на строке 308). Сделать при ближайшей уборке тестов.
- На момент создания скелета дополнительных записей не требовалось; новые вопросы добавлять сюда по мере миграции остальных модулей.