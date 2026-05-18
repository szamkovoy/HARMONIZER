---
id: 02_modules/assistant/dependencies
title: Assistant Dependencies
version: 1.7
updated: 2026-05-18
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/daily_forecast/spec, 02_modules/practices/spec, 02_modules/subscription/spec]
code_refs: [_legacy_web/app/api/communicator/v2/dialog/route.ts, _legacy_web/app/api/ai/monologue/route.ts, services/communicator-client.ts, services/aiClient.ts]
---

## 1. Зависит от

- **`astro`**
  - `natalProfileFromRow` / `user_natal_charts` в `_legacy_web/app/api/communicator/v2/dialog/route.ts` (`loadContext`) и в `_legacy_web/app/api/ai/monologue/route.ts` (`loadActiveNatalProfile`) для профиля и **`buildMathLevel`** / **`buildTopPetals`**.
- **`daily_forecast`**
  - Локальная строка **`user_daily_forecasts`** читается монологом утра и daily dialog v5 (`dialogDailyContext.ts`): кроме `planet_of_the_day` и гармоничности, ассистент теперь использует и фиксирует `day_target_chakra`, `day_target_reason`, `day_target_fixed_at`.
- **`profile`**
  - **`users`**: `locale`, **`address_form`**, `tz`, `membership_tier`, `trial_expires_at`, `lat`, `lon` для локального времени, обращения, выбора модели и фиксации day-context.
- **`communicator` / `profile` (новый серверный потребитель)**
  - Экран профиля читает агрегаты `daily_matrices` и practice-by-chakra через новые backend routes, которые переиспользуют pure helper-ы ассистента (`lifeMatrix.ts`, `dialogConfig.ts`, `lifeSpheresBaseline.ts`).
- **`practices`**
  - Таблица **`practices`**, связь **`practice_chakras`** в **`practiceSelection.ts`**; сессии **`practice_sessions`** для недавних ID в **`recentCompletedPracticeIds`**; клиентские маршруты запуска задаются в **`launchForPractice`** (асана / дыхание / «Вспышка»). **`_legacy_web/app/api/communicator/v2/dialog/route.ts`** (`**resolvePracticePublic**`) импортирует **`modules/practices/core/assistantSelectableDurations.ts`** для тех же шагов длительности карточки, что и **`PracticeCard`** на клиенте.
- **`infra`**
  - Next.js API routes, **`gemini`**, мониторинг ошибок маршрутов, переменные окружения на Vercel. Для v3 explicit context caching пока доступен только in-memory store без внешнего Redis.

## 2. От него зависят

- **`communicator`**
  - **`services/communicator-client.ts`**: `sendDialogMessage` / `fetchDialogSession` вызывают **`getAiDialogUrl()`** при наличии **`scenario_id`**, иначе **`getCommunicatorV2DialogUrl()`** — тот же обработчик диалога на сервере.
  - UI чата не содержит LLM-логики; только вызов API и отображение SSE.
- **`profile`**
  - `app/(tabs)/profile.tsx` и backend routes `api/profile/*` читают артефакты ассистента (`daily_matrices`, `planned_events`-derived range, chakra legend) для heatmap, range-trend и practice-by-chakra.
- **`daily_forecast`**
  - **`modules/home/useDayContent.ts`** вызывает **`callMonologue`** (`services/aiClient.ts`) для сценария **`morning_recommendation`** и **`fetchGlobalContent`** для free-tier контента; домашний экран смешивает forecast API и ассистента.
  - Коррекция текста рекомендации из диалога обновляет **`user_daily_forecasts`** в `dialog/route.ts` при маркере **`CORRECT_RECOMMENDATION`**.

## 3. Контрактные точки риска

- **Форма SSE-событий** — `communicator-client` по-прежнему ждёт `orchestrator_decision`, `chunk`, `complete`; смена имён событий или ключей (`practicePicked`, `turnMode`, `validation`) ломает UI тихо.
- **`dialog_system_v3`** — маршрут daily dialog v3 теперь жёстко зависит от наличия активного prompt в `public.prompts`; отсутствие строки даёт 500 на `getActivePrompt`.
- **`planned_events` / `daily_matrices`** — новые таблицы стали частью публичного серверного контура ассистента; рассинхрон SQL-типа и route-персистенции теперь ломает не только диалог, но и отчёты профиля.
- **`scenarios`**: неверный `cache_strategy` или отсутствие строки сценария — 404/500 на monologue.
- **`buildTopPetals` / `ranked_planets`**: смена формата прогноза без обновления утреннего пайплайна ломает монолог **`morning_recommendation`**.
- **`recentStackLimitForKind`** и триггер **`user_practice_preferences`** — влияют на разнообразие предложений; см. **`open_questions`** и **`practices`**.
- Симметрия с **`MAP.md`**: при изменении списка потребителей обновлять колонки **`Зависит от`** / **`От него зависят`**.
