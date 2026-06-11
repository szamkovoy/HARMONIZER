---
id: 02_modules/assistant/dependencies
title: Assistant Dependencies
version: 1.16
updated: 2026-06-09
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/daily_forecast/spec, 02_modules/practices/spec, 02_modules/subscription/spec]
code_refs: [_legacy_web/app/api/communicator/v2/dialog/route.ts, _legacy_web/app/api/ai/monologue/route.ts, services/communicator-client.ts, services/aiClient.ts]
---

## 1. Зависит от

- **`chakra`**
  - `_legacy_web/app/api/_utils/topPetals.ts` — `chakraLabelRu` в `PLANET_TO_CHAKRA.label` для утреннего монолога `buildTopPetals`.
  - `_legacy_web/app/api/_utils/globalTransitMath.ts` — `chakraLabelRu` в `PLANET_TO_CHAKRA.label` для free-tier global math (`buildGlobalMathLevel`).

- **`astro`**
  - `natalProfileFromRow` / `user_natal_charts` в `_legacy_web/app/api/communicator/v2/dialog/route.ts` (`loadContext`) и в `_legacy_web/app/api/ai/monologue/route.ts` (`loadActiveNatalProfile`) для профиля и **`buildMathLevel`** / **`buildTopPetals`**.
- **`daily_forecast`**
  - Локальная строка **`user_daily_forecasts`** читается монологом утра и daily dialog v5 (`dialogDailyContext.ts`): кроме `planet_of_the_day` и гармоничности, ассистент теперь использует и фиксирует `day_target_chakra`, `day_target_reason`, `day_target_fixed_at`.
- **`profile`**
  - **`users`**: `locale`, **`address_form`**, `tz`, `membership_tier`, `trial_expires_at`, `lat`, `lon` для локального времени, обращения, выбора модели и фиксации day-context.
- **`communicator` / `profile` (новый серверный потребитель)**
  - Экран профиля читает быстрый snapshot `profile_report_snapshots` с fallback rebuild из `daily_matrices`, а practice-by-chakra — через отдельный route. Оба profile-route переиспользуют pure helper-ы ассистента (`lifeMatrix.ts`, `dialogConfig.ts`, `lifeSpheresBaseline.ts`). Легенда чакр для этих routes — **`planetChakraLegend.ts`** (`buildChakraLegend()`, JSON `planet_chakra_map.json` на сервере), не `modules/home/planetChakra`.
- **`practices`**
  - Таблица **`practices`**, связь **`practice_chakras`** в **`practiceSelection.ts`**; сессии **`practice_sessions`** для недавних ID в **`recentCompletedPracticeIds`**; клиентские маршруты запуска задаются в **`launchForPractice`** (асана / дыхание / «Вспышка»). **`dialogPracticeCard.ts`** (`**resolvePracticeCard**`, порт прежнего `resolvePracticePublic`) импортирует **`@shared/assistantSelectableDurations`** (`_legacy_web/shared_core/assistantSelectableDurations.ts`, копия **`modules/practices/core/assistantSelectableDurations.ts`**) для тех же шагов длительности карточки, что и **`PracticeCard`** на клиенте.
- **`infra`**
  - Next.js API routes, **`gemini`**, мониторинг ошибок маршрутов, переменные окружения на Vercel. Для v3 explicit context caching пока доступен только in-memory store без внешнего Redis.
  - Опциональные серверные `TEST_MODE_*` (см. `docs/04_reference/test_mode.md`); при `NEXT_RUNTIME === "nodejs"` **`instrumentation.ts`** вызывает **`logTestModeStartupWarning`** из **`testMode.ts`**.

## 2. От него зависят

- **`communicator`**
  - **`services/communicator-client.ts`**: `sendDialogMessage` / `fetchDialogSession` вызывают **`getAiDialogUrl()`** при наличии **`scenario_id`**, иначе **`getCommunicatorV2DialogUrl()`** — тот же обработчик диалога на сервере; отдельно **`reconcileDialogPlans`** бьёт в **`POST /api/ai/dialog/reconcile-plans`** (реэкспорт **`POST /api/communicator/v2/dialog/reconcile-plans`**) — **совместимый no-op** (`{ applied: false }`): FSM пишет `planned_events`/`daily_matrices`/day-focus синхронно (`dialogBrainPersistence.ts`), клиент по-прежнему debounce-вызывает endpoint на idle/close/unmount.
  - UI чата не содержит LLM-логики; только вызов API и отображение SSE.
- **`profile`**
  - `app/(tabs)/profile.tsx` и backend routes `api/profile/*` читают артефакты ассистента (`daily_matrices`, `planned_events`-derived range) и server helpers для матрицы/сфер; chakra legend в отчётах — `buildChakraLegend()` (`planetChakraLegend.ts`).
- **`daily_forecast`**
  - **`modules/home/useDayContent.ts`** вызывает **`callMonologue`** (`services/aiClient.ts`) для сценария **`morning_recommendation`** и **`fetchGlobalContent`** для free-tier контента; домашний экран смешивает forecast API и ассистента.
  - Коррекция текста рекомендации из диалога обновляет **`user_daily_forecasts`** в `dialog/route.ts` при маркере **`CORRECT_RECOMMENDATION`**.

## 3. Контрактные точки риска

- **Форма SSE-событий** — `communicator-client` ждёт `chunk`, `complete`, `turn_artifacts`, `error` (и опционально legacy `orchestrator_decision`, которое FSM-маршрут больше не шлёт); UI-поля (`practicePicked`, `turnMode`, `validation`) — в `complete`, persist-артефакты (`planningPersistence`, `messageId`, `matrixCells`) — в `turn_artifacts`; смена имён или раскладки ключей ломает UI тихо.
- **FSM server guards (`dialogTurnGuards.ts`)** — клиент не дублирует: planning→practice coercion, practice-like planned-event filter, summarizing thin-answer / clarifying / post-dialog wind-down. Изменение сигнатур guard-функций или порядка веток в `route.ts` ломает поведение без изменения клиента.
- **FSM-промпты (`dialogBranchPrompts.ts`, `dialogTimeOfDay.ts`)** — daily dialog больше не рендерит `dialog_system_v3` из `public.prompts`; монологи и прочие маршруты по-прежнему читают свои `prompt_key` через `getActivePrompt()`.
- **`planned_events` / `daily_matrices` / `profile_report_snapshots`** — этот trio теперь часть публичного серверного контура ассистента; рассинхрон SQL-типа и route-персистенции ломает и live planning/summarizing, и Day tab/debug export, и профильные отчёты.
- **`scenarios`**: неверный `cache_strategy` или отсутствие строки сценария — 404/500 на monologue.
- **`buildTopPetals` / `ranked_planets`**: смена формата прогноза без обновления утреннего пайплайна ломает монолог **`morning_recommendation`**.
- **`recentStackLimitForKind`** и триггер **`user_practice_preferences`** — влияют на разнообразие предложений; см. **`open_questions`** и **`practices`**.
- Симметрия с **`MAP.md`**: при изменении списка потребителей обновлять колонки **`Зависит от`** / **`От него зависят`**.
