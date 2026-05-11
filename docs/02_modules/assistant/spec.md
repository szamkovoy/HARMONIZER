---
id: 02_modules/assistant/spec
title: Assistant Spec
version: 1.6
updated: 2026-05-11
depends_on: [01_foundation/product_model, 02_modules/astro/spec, 02_modules/daily_forecast/spec, 02_modules/practices/spec, 02_modules/subscription/spec]
code_refs: [_legacy_web/app/api/ai/monologue/route.ts, _legacy_web/app/api/ai/dialog/route.ts, _legacy_web/app/api/communicator/v2/dialog/route.ts, _legacy_web/app/api/_utils/scenarios.ts, _legacy_web/app/api/_utils/prompts.ts, _legacy_web/app/api/_utils/orchestrator.ts, _legacy_web/app/api/_utils/insightDetection.ts, _legacy_web/app/api/_utils/authorVoice.ts, _legacy_web/app/api/_utils/gemini.ts, _legacy_web/app/api/_utils/topPetals.ts, _legacy_web/app/api/_utils/mathLevelBuilder.ts, _legacy_web/app/api/_utils/userModelTier.ts, _legacy_web/app/api/_utils/scenarioCache.ts, _legacy_web/app/api/_utils/explicitSignals.ts, _legacy_web/app/api/_utils/softCap.ts, _legacy_web/app/api/communicator/v2/dialog/practiceSelection.ts, _legacy_web/config/contentLengths.ts, services/aiClient.ts, supabase/migrations/20260501173500_scenarios_architecture.sql, supabase/migrations/20260511140000_revert_dialog_quality_v4.sql]
---

## 1. Назначение

Серверный слой **LLM-ассистента**: монологи (один запрос Gemini → JSON или текст) и диалоги с **оркестратором** (JSON-решение фазы) и **респондером** (потоковый текст по активному промпту фазы). Управляет промптами и фазами из Supabase, кешем сценариев, выбором практики в фазах практики и метриками инсайта (CSI / TTM / ETV). Клиентский UI чата и транспорт SSE на стороне приложения относятся к модулю `communicator`; расчёт астроданных — к `astro` / `daily_forecast`; усреднение калибровки по голосу без оркестратора — к `calibration`.

## 2. Публичный контракт

Набор **HTTP API** на Vercel (`_legacy_web`), авторизация Bearer JWT Supabase.

### Монологи

- **`POST /api/ai/monologue`** (`_legacy_web/app/api/ai/monologue/route.ts`)
  - Тело: `{ scenario_id: string; variables?: Record<string, unknown> }`.
  - Резолвит строку **`scenarios`** по `scenario_id`, берёт активный промпт по `monologue_prompt_key`, подставляет переменные, вызывает Gemini JSON (`generateGeminiJson`).
  - Кеш: таблица **`scenario_cache`**, стратегия из сценария (`per_user_per_day`, `per_user_per_calibration`, `no_cache`). Утренний сценарий инвалидируется при смене модели или отсутствии `modelUsed` в кэше (`isStaleMorningCache`).
  - Специальные сценарии в коде:
    - **`morning_recommendation`** — собирает переменные из последнего `user_daily_forecasts`, натала, калибровки, пользователя; строит топ-3 планеты (`buildTopPetals`), **`math_level`** (`buildMathLevel`), голос автора, подсказку обращения (`address_form` → hint).
    - **`psychological_portrait`** — добавляет `portrait_target_chars` из `CONTENT_LENGTHS`.

Клиент: **`callMonologue(scenarioId, variables)`** в `services/aiClient.ts` → тот же endpoint.

### Диалог (оркестратор + респондер)

- **`POST /api/ai/dialog`** — реэкспорт обработчика из **`POST`** `_legacy_web/app/api/communicator/v2/dialog/route.ts` (тот же код).
- **`POST /api/communicator/v2/dialog`** — помечен deprecated в логах (`warnDeprecatedDialogRoute`), поведение идентично для совместимости.

Поведение **`POST`**:

- Тело: `scenario_id?`, `conversationId?`, `useCase?` (`daily_dialog` \| `calibration` \| …), `entrySource`, `triggerMeta`, `userMessage`, `userTimezone`.
- Резолв сценария: при переданном **`scenario_id`** строка **`scenarios`** должна иметь `scenario_type = dialogue` и `dialogue_use_case`; иначе используются **`useCase`** и дефолты (`daily_dialog` / `calibration`).
- Загрузка фаз: **`dialogue_phases`** по `use_case`.
- **`buildDecision`**: метрики инсайта (`buildInsightMetrics`), обход приветствия (`greetingBypassDecision`), при необходимости переиспользование решения оркестратора (`contextSimilarity`, `shouldForceFreshDecision`), метрики последних ходов (`buildDialogTurnMetrics`: последние фазы/регистры ассистента, «давность» упоминаний астрологии/чакр в тексте ассистента), **`detectExplicitSignals`** по последнему сообщению пользователя → **`explicit_signals_json`** в шаблон оркестратора; ось **`information_axes`** для промпта дополняется **`soft_cap`** из **`getSoftCap(useCase, tier)`** (тариф из `users.membership_tier` / `trial_expires_at`), затем промпт **`orchestrator_decision`** → JSON **`OrchestratorDecision`** (`validateOrchestratorDecision`, нормализация **`responder_hints`**). Insight-guard для `daily_dialog` переопределяет фазы практики при неготовности TTM (`enforceInsightPhaseGuards`).
- Ответ: **SSE** — событие `orchestrator_decision`, затем поток `chunk`, затем `complete` с `conversationId`, `messageId`, текстом, `practicePicked`, коррекцией рекомендации и т.д.
- Для каждой фазы: активный промпт по **`prompt_key`** фазы + общий **`responder_main`** (активная версия в БД), потоковый текст (`streamGeminiText`), модель поверхности через **`dialogSurfaceModelHint`**. В рендер **`responder_main`** дополнительно подставляются, среди прочего, **`conversation_history`**, **`user_last_message`**, **`user_message_length_hint`**, **`user_register_hint`** (из **`user_register`** решения), **`astrology_budget_hint`** / **`chakra_budget_hint`** (из **`responder_hints`** решения или эвристик по метрикам ходов), **`orchestrator_hints`**, **`user_locale`**.
- В **`suggest_practice`**: серверный выбор практики **`choosePractice`** (игнорируя галлюцинацию id по возможности и подставляя стек из каталога).

**`GET /api/ai/dialog`** / **`GET /api/communicator/v2/dialog`** — синхронизация сессии (история сообщений за окно ~2 ч).

### Вспомогательные LLM-маршруты (тот же продуктовый контур)

- **`POST /api/communicator/v2/greeting`** — короткое приветствие без полного диалога (промпты + контекст профиля / прогноза).
- **`POST /api/communicator/v2/recommendation-text`** — генерация короткого/длинного текста по строке прогноза (`prompt_key` из БД).

### Не входят в этот spec

- **`POST /api/ai/global-content`** — раздача прекомпутированного глобального контента по тарифу; связан с подпиской и утренним UX, но не является оркестратором ассистента.
- **`/api/calibration/extract`** — модуль `calibration` (extract / averaging), может использоваться параллельно голосовой калибровке.

### Типы решений оркестратора (сводка)

Используются поля из `_legacy_web/app/api/_utils/orchestrator.ts`: `next_phase`, `reasoning`, `information_completeness`, `information_density`, `user_signals`, опционально **`user_register`**, `should_close`, `close_reason`, **`responder_hints`** (в т.ч. **`tone`**, **`use_user_phrases`**, **`avoid_topics`**, опционально **`preferred_register`**, **`astrology_budget`**, **`chakra_budget`**, **`length_hint`**), опционально **`decision_source`** (`fresh` \| `bypass_greeting` \| `cache_reused`), **`cache_similarity`**, **`insight_metrics`** (пишется в объект решения и в логи событий).

## 3. Внутренняя архитектура

| Компонент | Роль |
| --- | --- |
| **`scenarios` / `getScenario`** | Декларативный реестр монологов и диалогов; связь с промптом монолога или `dialogue_use_case`. |
| **`prompts` / `getActivePrompt` / `renderPrompt`** | Шаблоны с подстановкой `{{var}}`; одна активная версия на `prompt_key`. |
| **`dialogue_phases`** | Упорядоченные фазы по `use_case`, ключ промпта, silent / terminal. |
| **`orchestrator.ts`** | Эвристики времени суток, bypass первого хода, similarity-кеш решений, валидация JSON решения. |
| **`insightDetection.ts`** | CSI, детектор «инсайта», TTM-стадия по маркерам, валентность, ETV. |
| **`practiceSelection.ts`** | Загрузка практик из БД, фильтры по намерению пользователя, **`recentStackLimitForKind`**, маркер **`[PRACTICE_PICK: …]`**, статический fallback медитации «Вспышка». |
| **`authorVoice.ts` + `data/author_voice.json` (v2)** | Профиль голоса: `archetype`, `usage_note`, `preferred_lexicon` (в т.ч. `openers_neutral` / `openers_observational`), `forbidden`, `rhythm_rules`, `core_value`, `few_shot_examples` (каждый пример: `user_says`, `assistant_should_NOT_say`, `assistant_SHOULD_say`, `why`); подстановка в респондер и монологи через **`formatAuthorVoiceForPrompt`**. |
| **`topPetals.ts` / `mathLevelBuilder.ts`** | Сбор топ-планет из прогноза и сборка **`math_level`** для утреннего монолога (формулы активации импортируют `daily-engine`). |
| **`userModelTier.ts`** | `dialogSurfaceModelHint` — для платного доступа поверхностный поток на `"premium"`, иначе подсказка из промпта / `"standard"`. |
| **`scenarioCache.ts`** | Ключ кеша по стратегии сценария. |
| **`explicitSignals.ts` + `data/dialog_signals.json`** | `detectExplicitSignals` — матчинг явных сигналов пользователя по локализованным фразам (`ru` / `en`). |
| **`softCap.ts` + `data/information_axes.json`** | `getSoftCap(useCase, tier)` — числовой soft cap для сценария и тарифа; источник — env, при отсутствии валидного значения — slice JSON (`calibration` / `daily_dialog`). |

Персистенция диалога: **`conversations`**, **`messages`**; в **`messages.meta** сохраняются `orchestrator_decision`, ответ респондера, **`practice_picked`**, предложения состояний. **`user_event_log`** фиксирует `decision_source`, латентности, similarity.

## 4. Конфигурация и параметры

- **`_legacy_web/config/contentLengths.ts`** — целевые длины слогана, короткого и длинного текста, портрета.
- **Переменные окружения (диалог):** `DIALOG_GREETING_BYPASS_ENABLED`, `DIALOG_DECISION_CACHE_ENABLED`, `DIALOG_DECISION_CACHE_MIN_ITERATION`, `DIALOG_DECISION_CACHE_THRESHOLD` — bypass первого хода и кеш решений оркестратора.
- **Переменные окружения (soft cap, читает `softCap.ts`):** `DIALOG_SOFT_CAP_CALIBRATION`; для сценария `daily_dialog` — `DIALOG_SOFT_CAP_DAILY_FREE`, `DIALOG_SOFT_CAP_DAILY_TRIAL`, `DIALOG_SOFT_CAP_DAILY_PREMIUM`. При невалидном или пустом значении — fallback из `information_axes.json` (`calibration.soft_cap` / `daily_dialog.soft_cap`).
- **Gemini:** модели через **`getModelByHint`** из `model_hint` промпта; опционально **`getModelByHint(..., { fallback: true })`** читает `AI_MODEL_STANDARD_FALLBACK` / `AI_MODEL_PREMIUM_FALLBACK` (при отсутствии значения цепочка без env-fallback). Вызовы `generateGeminiJson` / `generateGeminiText` / `streamGeminiText` строят цепочку primary→env fallback→`fallbackModels` и при сбое переходят к следующей модели, если сообщение об ошибке похоже на перегрузку, исчерпание квоты или **404**/NOT_FOUND (один шаг за итерацию; в логах предупреждение **`[GEMINI FALLBACK]`**). Если после цепочки последняя ошибка всё ещё выглядит как перегрузка/квота — клиенту отдаётся короткое «Сервис временно недоступен…»; иначе пробрасывается исходная ошибка. Оркестратор обычно остаётся на подсказке промпта (`standard`), респондер для премиум-пользователя принудительно **`premium`** поверх `dialogSurfaceModelHint`.
- **БД:** сиды и миграции задают строки `prompts`, `dialogue_phases`, `scenarios` (в т.ч. PATCH по фазам и монологам). Откат смены промптов v4 — миграция **`20260511140000_revert_dialog_quality_v4.sql`**; файл **`20260509120000_dialog_quality_v4.sql`** удалён из репозитория после применения отката в БД. Тексты промптов в каноне — в БД и миграциях, не дублировать в документе.

## 5. Известные ограничения

- Два URL диалога (**`/api/ai/dialog`** и **`/api/communicator/v2/dialog`**): клиент без `scenario_id` всё ещё использует старый путь (`services/communicator-client.ts`).
- Выбор практики в **`choosePractice`** привязывает чакру к **`planet_of_the_day`**, тогда как утренний монолог опирается на топ-3 по importance — возможен продуктовый разрыв темы дня vs стека практики (зафиксировано в `history.md`).
- **`TERMINAL_PHASES`** в коде включает **`suggest_practice`** — влияет на кеш решений и может расходиться с устной моделью «терминальность только закрытие».
- Ошибка монолога **`morning_recommendation`** при `< 3` лепестков защитная; при нормальном прогнозе на 7 планет после ранжирования не возникает.

## Справочные материалы

- `docs/04_reference/astrology/activation_and_importance.md` — смысл activation / importance в **`math_level`** и прогнозе.
- `docs/04_reference/astrology/harmoniousness.md` — связь H/S с тоном лепестков.
- `docs/01_foundation/product_model.md` — тон и границы коуча (согласованность с респондером).

Тексты промптов и few-shot фазы — только в Supabase (`prompts`) и миграциях (`supabase/migrations/*`, `seed.sql`).
