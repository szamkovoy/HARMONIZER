---
id: 02_modules/assistant/dependencies
title: Assistant Dependencies
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/daily_forecast/spec, 02_modules/practices/spec, 02_modules/subscription/spec]
code_refs: [_legacy_web/app/api/communicator/v2/dialog/route.ts, _legacy_web/app/api/ai/monologue/route.ts, services/communicator-client.ts, services/aiClient.ts]
---

## 1. Зависит от

- **`astro`**
  - `natalProfileFromRow` / `user_natal_charts` в `_legacy_web/app/api/communicator/v2/dialog/route.ts` (`loadContext`) и в `_legacy_web/app/api/ai/monologue/route.ts` (`loadActiveNatalProfile`) для профиля и **`buildMathLevel`** / **`buildTopPetals`**.
- **`daily_forecast`**
  - Последняя строка **`user_daily_forecasts`** читается оркестратором и монологом утра (`loadLatestForecast`, `loadContext`); поля **`ranked_planets`**, **`importance`**, **`planet_of_the_day`**, **`transit_chart`** используются в **`topPetals`**, **`mathLevelBuilder`**, компактных DTO респондера.
- **`calibration`**
  - **`user_calibrations`** в контексте диалога и монолога; токены пользователя для топ-лепестков; оркестратор **`use_case = calibration`** обслуживает голосовую калибровку в этом же route. Параллельно существует **`/api/calibration/extract`** (другой модуль) — см. `history.md`.
- **`profile`**
  - **`users`**: `locale`, **`address_form`**, `tz`, `membership_tier`, `trial_expires_at` для подсказок обращения, тира LLM и времени суток.
- **`practices`**
  - Таблица **`practices`**, связь **`practice_chakras`** в **`practiceSelection.ts`**; сессии **`practice_sessions`** для недавних ID в **`recentCompletedPracticeIds`**; клиентские маршруты запуска задаются в **`launchForPractice`** (асана / дыхание / «Вспышка»).
- **`subscription`**
  - **`userModelTier.ts`**: `hasPremiumLlmAccess`, **`dialogSurfaceModelHint`** — выбор фактической модели поверхности диалога (респондер, greeting, recommendation-text) по тарифу/триалу.
- **`infra`**
  - Next.js API routes, **`gemini`**, мониторинг ошибок маршрутов, переменные окружения на Vercel.

## 2. От него зависят

- **`communicator`**
  - **`services/communicator-client.ts`**: `sendDialogMessage` / `fetchDialogSession` вызывают **`getAiDialogUrl()`** при наличии **`scenario_id`**, иначе **`getCommunicatorV2DialogUrl()`** — тот же обработчик диалога на сервере.
  - UI чата не содержит LLM-логики; только вызов API и отображение SSE.
- **`calibration`**
  - Сценарий **`scenario_id = calibration`** или **`useCase = calibration`** в том же **`dialog/route.ts`**; фазы **`welcome_and_hint` … `acknowledge_and_close`** в **`dialogue_phases`**.
  - Extract-пайплайн не дублируется здесь — см. модуль **`calibration`**.
- **`daily_forecast`**
  - **`modules/home/useDayContent.ts`** вызывает **`callMonologue`** (`services/aiClient.ts`) для сценария **`morning_recommendation`** и **`fetchGlobalContent`** для free-tier контента; домашний экран смешивает forecast API и ассистента.
  - Коррекция текста рекомендации из диалога обновляет **`user_daily_forecasts`** в `dialog/route.ts` при маркере **`CORRECT_RECOMMENDATION`**.

## 3. Контрактные точки риска

- **Форма DTO оркестратора и событий SSE** — изменение полей **`OrchestratorDecision`** ломает **`communicator-client`** и клиентские типы **`OrchestratorDecision`**.
- **`prompt_key` в `dialogue_phases`** и активная версия **`responder_main`** / фаз — рассинхрон ведёт к 500 на `getActivePrompt`.
- **`scenarios`**: неверный `cache_strategy` или отсутствие строки сценария — 404/500 на monologue.
- **`buildTopPetals` / `ranked_planets`**: смена формата прогноза без обновления утреннего пайплайна ломает монолог **`morning_recommendation`**.
- **`recentStackLimitForKind`** и триггер **`user_practice_preferences`** — влияют на разнообразие предложений; см. **`open_questions`** и **`practices`**.
- Симметрия с **`MAP.md`**: при изменении списка потребителей обновлять колонки **`Зависит от`** / **`От него зависят`**.
