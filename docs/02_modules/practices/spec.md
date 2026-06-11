---
id: 02_modules/practices/spec
title: Practices Spec
version: 1.10
updated: 2026-05-26
depends_on: [01_foundation/product_model, 02_modules/subscription/spec, 02_modules/biofeedback/spec, 02_modules/audio/spec, 02_modules/bindu/spec]
code_refs:
  [
    modules/practices/index.ts,
    modules/practices/core/assistantSelectableDurations.ts,
    modules/practices/core/types.ts,
    modules/practices/ui/PracticeCatalogScreen.tsx,
    modules/practices/ui/launchPractice.ts,
    modules/breath/index.ts,
    modules/breath/ui/CoherenceBreathScreen.tsx,
    modules/mandala/experiments/SacredSymbolStreamScreen.tsx,
    app/(tabs)/practices.tsx,
    app/breath-coherence.tsx,
    app/sacred-symbol-stream.tsx,
    app/asana-practice.tsx,
    app/(tabs)/index.tsx,
    services/practiceSessions.ts,
    _legacy_web/app/api/communicator/v2/dialog/practiceSelection.ts,
  ]
---

## 1. Назначение

Модуль **practices** объединяет каталог практик в приложении (медитация, дыхание, асаны из БД), единый способ **запуска** по маршрутам Expo Router и **запись сессий** в Supabase для статистики и контекста ассистента. Рантайм-дыхание и синхронизация звука с фазами вынесены в **`modules/breath/`** (внутренний движок подсценария дыхания; в `MAP.md` не выделяется отдельным модулем).

## 2. Публичный контракт

### Пакет `modules/practices` (`index.ts`)

- **`loadPracticeCatalog(options?, deps?): Promise<PracticeCatalog>`**  
  Собирает каталог: статическая медитация «Вспышка», дыхательные практики из `BREATH_PRACTICES` (`modules/breath/core/practices.ts`), асаны из Supabase `practices` с `kind = 'yoga'` и вложенным `practice_chakras`. Таймаут загрузки йоги — 12 с. Без `onLateYogaPractices` при таймауте в возвращаемом объекте йога пустая. С `onLateYogaPractices` каталог возвращается сразу с пустой йогой; колбэк вызывается не позже чем через 12 с (при ошибке или таймауте — `[]`), а если ответ Supabase пришёл после таймаута — возможен повторный вызов с фактическим списком асан.

- **`filterPractices(practices, filters): PracticeSummary[]`** / **`sortPracticesForCatalog(practices): PracticeSummary[]`**  
  Фильтр по чакре и «корзине» длительности; сортировка через `@shared/selector`.

- **`practiceDurationDistance`**, **`practiceQuality`**, **`practiceRecordedAtMs`**, **`recentStackLimitForKind`**, **`selectPracticeCandidate`**, **`sortPracticeCandidatesForCatalog`**, **`sortPracticeCandidatesForRecommendation`**  
  Реэкспорт из `@shared/selector` для каталога и для серверного выбора практики (см. `practiceSelection.ts`).

- **Типы:** `PracticeCatalog`, `PracticeCatalogFilters`, `PracticeDurationBucket`, `PracticeDurationPolicy`, `PracticeKind`, `PracticeLaunchParams`, `PracticeSummary`, `PracticeVideoMetadata`, `PracticeSelectorCandidate`, и т.д.; **`PracticeRecommendation`**, **`PracticeRecommendationLaunch`** из `@shared/recommendation`.

- **`PracticeCatalogScreen`**  
  UI вкладки «Практики»: загрузка каталога, фильтры, `launchPractice(..., { launchSource: 'catalog' })`. При отложенной йоге (`onLateYogaPractices`) после `await loadPracticeCatalog` выполняется yield микрозадач (`await Promise.resolve()`), затем в состояние подмешивается йога из слота; медитации и дыхание кэшируются в ref, чтобы колбэк мог собрать полный каталог до перехода экрана в `ready` (медленный ответ Supabase).

- **`launchPractice(launch, options?): boolean`**  
  Навигация: поддерживает `PracticeLaunchParams` (каталог) и `PracticeRecommendationLaunch` (объект с `route` + `params` от ассистента). Добавляет `launchSource` в query при необходимости. Возвращает `false`, если нет `launch.route`.

- **`PracticeCard`** (`modules/practices/ui/PracticeCard.tsx`)  
  Единый UI-компонент карточки практики для каталога и коммуникатора. Поддерживает override `duration` и, для практик без жёсткой привязки к видео, override `chakra`; локализация и кнопка запуска одинаковы в обоих входах. Значение `overrideDurationMinutes` **клипится** к списку допустимых минут (`**assistantSelectableDurations.ts**`, синхронно с сервером для дыхания 5–20 и медитации 1–5); при клипе — `console.log` с тегом **`[PRACTICE_CARD_MISMATCH]`** (поля в духе серверного JSON плюс **`source: "practice_card_client_sync"`**, `conversationId` обычно `null`). После ручного выбора минут карточка не синхронизирует состояние обратно с catalog/default props, пока не сменилась сама `practice.id`, поэтому пользовательская длительность медитации/дыхания не сбрасывается перед запуском. Дефолт чакры для meditation/breath берётся из `primaryChakra` / `chakraIds`, если поверхность передала дневной фокус.

### Утилита `modules/practices/core/assistantSelectableDurations.ts`

- Канонический клиентский модуль: **`selectableDurationMinutesForPracticeCard`**, **`clipDurationMinutesToSelectableMinutes`**, константа **`PRACTICE_CARD_DURATION_MISMATCH_THRESHOLD_MIN`** (2) для логов расхождения маркера с историей в `resolvePracticePublic`.
- Для Vercel-only deploy (`_legacy_web`): копия в **`_legacy_web/shared_core/assistantSelectableDurations.ts`** (импорт **`@shared/assistantSelectableDurations`** из **`route.ts`**); содержимое должно оставаться синхронным с клиентским файлом (как у **`@shared/selector`**).

### Сервис `services/practiceSessions.ts`

- **`recordPracticeSession(input): Promise<string | null>`**  
  Вставка в `practice_sessions`. Поля, которыми пользуются экраны: `user_id`, `practice_id` (опционально), `practice_slug`, `practice_version`, `started_at`, `ended_at`, `self_rating`, `completion_pct`, `metrics` (jsonb), `chakra_focus_ids`, `context` (jsonb).

- **`loadDailyPracticeStats(userId, limit?): Promise<DailyPracticeStat[]>`**  
  Чтение `user_daily_stats`: `user_id`, `local_date`, `total_practice_seconds`, `practice_count`, `chakras_touched`, `updated_at`.
  Дополнительно вкладка «День» через `services/dayHealthContext.ts` читает последние строки `user_daily_stats`, чтобы перед summary-веткой дать ассистенту compact-сравнение йоги за подытоживаемый день с обычной практикой пользователя. Текущее baseline-сравнение берётся по 7 последним дням как реальное дневное среднее (нулевые дни тоже учитываются); если исторической базы нет, server prompt использует мягкий ориентир достаточности около 30 минут практики в день.

- **`selfRatingFromMood(mood)`** — маппинг настроения на `self_rating`.

### Роуты приложения (контракт query-параметров)

- **`app/breath-coherence.tsx`** → `CoherenceBreathScreen`: `practiceId` (`BreathPracticeId`), `durationMs`, `chakra` (1–7), `launchSource`, `usePulseSensor` (`"false"` отключает сценарий с пульсометром; иначе по умолчанию включено).

- **`app/sacred-symbol-stream.tsx`** → `SacredSymbolStreamScreen`: `durationMs`, `chakra`, `launchSource`. Параметр **`practiceId` из каталога не читается** (в каталоге одна медитация). При `launchSource = "assistant" | "day"` завершение медитации возвращает пользователя на `/day`, а не назад на предыдущий экран, чтобы после ассистентской рекомендации пользователь попадал во вкладку «День».

- **`app/asana-practice.tsx`**: `practiceId` (UUID строки практики), опционально `durationMs`, `chakra`, `launchSource`.

### Дыхательный движок `modules/breath` (исполнение, не barrel `practices`)

- **`CoherenceBreathScreen`** (пропсы см. компонент): мандала + звук + опционально PPG; по завершении пишет **`metrics`** из исхода дыхания (`outcomeToCommunicatorPayload`) в `practice_sessions`.

- Экспортируемые типы/константы для каталога и роутов: **`BreathPracticeId`**, **`Chakra`**, **`BREATH_PRACTICES`**, **`isChakra`**, и т.д. (`modules/breath/index.ts`).

### Интеграция с ассистентом (реализовано в коде)

- Сервер: **`choosePractice`** / сбор кандидатов и формирование **`launch`** с `practiceId` / slug в `_legacy_web/app/api/communicator/v2/dialog/practiceSelection.ts` (в т.ч. статическая медитация `sacred-symbol-stream`, дыхание по slug, йога по UUID). Для не-`default` маркера **`[PRACTICE_PICK]`** id резолвится по полному каталогу; недавние сессии и **`practice_picked`** нормализуются к каноническому **`id`** строки каталога, затем **`selectPracticeCandidate`** исключает повторы **только по этому `id`**. Server fallback-текст карточки (`practiceCardSummary.ts`) для chakra labels в RU использует нумерованные названия в нужном падеже (`зона шестой чакры`) в карточных описаниях, а visible assistant reason отдельно мотивирует выполнить практику сейчас и не дублирует текст карточки.
- Клиент: **`Communicator`** SSE `complete.practicePicked` → общий **`modules/practices/ui/PracticeCard.tsx`** → `launchPractice` с `launchSource: 'assistant'`; отдельного `launchPracticeFromAssistant` на home больше нет.  
  Автоматизированных E2E-тестов полного диалога в репозитории нет — это ограничение процесса QA, не отсутствие кода.

## 3. Внутренняя архитектура

```text
modules/practices/
  core/types.ts           — доменные типы каталога и launch
  core/catalog.ts         — сбор PracticeCatalog (static + breath + Supabase yoga)
  ui/PracticeCatalogScreen.tsx, PracticeCard.tsx
  ui/launchPractice.ts    — router.push с params

modules/breath/         — дыхательный подсценарий (фазы, PPG, итоговые метрики)
  core/breath-phase-planner.ts — PlannedCycle для mandala-sound
  ui/CoherenceBreathScreen.tsx, BreathBinduMandala.tsx, …

modules/mandala/experiments/SacredSymbolStreamScreen.tsx — медитация «Вспышка»

app/(tabs)/practices.tsx → PracticeCatalogScreen
app/breath-coherence.tsx  → CoherenceBreathScreen
app/sacred-symbol-stream.tsx → SacredSymbolStreamScreen
app/asana-practice.tsx    — метаданные асаны + завершение без плеера

services/practiceSessions.ts — Supabase insert/select
```

- **`audio`**: `MandalaSoundProvider` на экранах медитации и дыхания; такт дыхания задаётся планировщиком фаз в **`modules/breath`** (`PlannedCycle`), см. `docs/02_modules/audio/dependencies.md`.

- **`bindu`**: визуал мандалы / сукцессия на медитации и дыхании.

- **`biofeedback`**: только в **`CoherenceBreathScreen`** (камера / эмуляция); **`SacredSymbolStreamScreen`** не подключает пайплайн PPG и сохраняет **`metrics: {}`**.

## 4. Конфигурация и параметры

- **Виды практик в UI:** `PRACTICE_GROUPS` — «Медитации», «Дыхание», «Асаны»; в БД для асан используется **`kind = 'yoga'`** (соглашение: в продукте «Асаны», в схеме — `yoga`).

- **Медитация:** одна статическая карточка, slug `sacred-symbol-stream`; пользовательский диапазон в каталоге/карточке и у ассистента — **1–5 минут**; дефолт launch в **`catalog.ts`** остаётся **3 мин**, а экран **`SacredSymbolStreamScreen`** при отсутствии params использует **5 мин** — расхождение дефолтов зафиксировано в `history.md`.

- **Дыхание:** семь типов (`coherent`, `nadi-shodhana`, `surya-bhedana`, `chandra-bhedana`, `square`, `triangle-up`, `triangle-down`); описания каталога RU захардкожены в `catalog.ts`.

- **Assistant entry:** default marker `id="default"` на сервере резолвится в coherent breathing 600 секунд с чакрой дня; в UI пользователь может поменять duration/chakra перед стартом через общий `PracticeCard`. Если пользователь просит **короткую / минимальную** практику без явного числа минут, серверный валидатор (`markers.ts`) берёт нижнюю границу каталога для уже названного типа: медитация 1 мин, дыхание 5 мин, асаны 20 мин.

- **Йога:** выборка активных строк `practices` + связи `practice_chakras`; превью по `readPracticeVideoThumbnailFromParams` из `params`.

- **Сессии и контекст:** в `context` JSON кладутся продуктовые поля (`source`, `launch_source`, `practice_kind`, для асан — `vimeo_id` и т.д.) для аналитики и ассистента.
- **Ожидающая практика вкладки «День»:** незавершённая карточка хранится не в `practice_sessions`, а в `day_practice_offers` (одна `pending` row на `user_id + local_date`). Источник offer — ручной выбор на вкладке или callback `Communicator.onPracticeOffered(...)` при ассистентской `PRACTICE_PICK`-карточке. Завершённые практики по-прежнему попадают в отчёты только через `practice_sessions`; `GET /api/day` автоматически считает pending offer завершённым, если в этот день появилась matching completed session после создания offer.

## 5. Известные ограничения

- **Vimeo на экране асан:** вместо плеера — заглушка с текстом о том, что локальный WebView в текущем dev-client недоступен; отображаются метаданные и **Vimeo ID**. Завершение практики и запись сессии работают.

- **Медитация:** нет записи биометрических метрик в `practice_sessions.metrics` (в отличие от дыхания).

- **`user_practice_preferences`:** триггер в БД обновляет строки при вставке/обновлении `practice_sessions` с **непустым `practice_id`**; клиент передаёт **`practice_id` только для асан**; дыхание и медитация пишут в основном **`practice_slug`** без UUID — предпочтения по UUID-практикам для них триггером не ведутся.

- Полная схема БД и RLS: **`supabase/migrations/20260423080000_init.sql`** (`practices`, `practice_chakras`, `practice_sessions`, `user_daily_stats`), **`supabase/migrations/20260429051600_calibration_dialogue_orchestrator.sql`** (`user_practice_preferences` и триггеры).

## Справочные материалы

Методика и метрики не дублируются здесь; см.:

- `docs/04_reference/breathing_techniques/coherent_breathing.md`
- `docs/04_reference/breathing_techniques/channel_breathing.md`
- `docs/04_reference/breathing_techniques/rhythmic_breathing.md`
- `docs/04_reference/biometrics/rmssd.md`
- `docs/04_reference/biometrics/stress_index_baevsky.md`
- `docs/04_reference/biometrics/rsa.md`
- `docs/04_reference/biometrics/entry_time.md`
- `docs/04_reference/biometrics/coherent_breathing.pdf` (ресурс в том же каталоге)
