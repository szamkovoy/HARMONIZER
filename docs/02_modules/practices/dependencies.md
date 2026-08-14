---
id: 02_modules/practices/dependencies
title: Practices Dependencies
version: 1.18
updated: 2026-08-14
depends_on:
  [
    01_foundation/product_model,
    02_modules/subscription/spec,
    02_modules/biofeedback/spec,
    02_modules/audio/spec,
    02_modules/bindu/spec,
    02_modules/daily_forecast/spec,
    02_modules/affirmations/spec,
  ]
code_refs:
  [
    modules/practices/ui/PracticeCatalogScreen.tsx,
    modules/practices/core/catalog.ts,
    modules/practices/core/vimeo.ts,
    modules/remote-play/index.ts,
    app/(tabs)/practices.tsx,
    app/(tabs)/index.tsx,
    app/asana-practice.tsx,
    app/breath-coherence.tsx,
    app/sacred-symbol-stream.tsx,
    modules/mandala/experiments/SacredSymbolStreamScreen.tsx,
    modules/breath/ui/CoherenceBreathScreen.tsx,
    services/practiceSessions.ts,
  ]
---

## 1. Зависит от

- **`subscription`**  
  `app/(tabs)/_layout.tsx` — таб «Практики» виден всем (каталог — витрина); `modules/practices/ui/PracticeCatalogScreen.tsx`, `app/(tabs)/day.tsx`, `app/asana-practice.tsx` — `canUseFeature` / `AccountGateDialog` на запуск (`meditations` / `breath_practices` / `asana_practices`). Парная запись: `docs/02_modules/subscription/dependencies.md` §2.

- **`daily_forecast`**  
  Прямой импорт прогноза в **`modules/practices/`** отсутствует. Связь через главный экран: `app/(tabs)/index.tsx` при открытом оверлее ассистента передаёт в `Communicator` forecast-метаданные дня; серверный выбор практики (`_legacy_web/app/api/communicator/v2/dialog/practiceSelection.ts`) может учитывать контекст дня и вернуть coherent breathing на чакру дня. Парная запись: `docs/02_modules/daily_forecast/dependencies.md` §2.

- **`biofeedback`**  
  `app/breath-coherence.tsx` → **`CoherenceBreathScreen`** — PPG / BLE pipeline, wearable preferences (`modules/biofeedback/wearables/preferences.ts`), общий **`WearablePickerDialog`** (`modules/biofeedback/wearables/WearablePickerDialog.tsx`) и запись **`metrics`** в `practice_sessions`. `PracticeCard.tsx` читает remembered BLE-датчик из biofeedback-модуля и открывает тот же picker до старта, чтобы запекать `sensorMode/deviceId/capabilityTier` в launch-контракт. Медитация **`SacredSymbolStreamScreen`** biofeedback не использует. Парная запись: `docs/02_modules/biofeedback/dependencies.md` §2.

- **`audio`**  
  `CoherenceBreathScreen` и `SacredSymbolStreamScreen` монтируют **`MandalaSoundProvider`** с prop **`soundBed`** из launch query (карточка/`launchPractice`); план фаз (`PlannedCycle`) — из **`modules/breath/core/breath-phase-planner.ts`** (подсценарий practices). Парная запись: `docs/02_modules/audio/dependencies.md` §1.

- **`bindu`**  
  `BreathBinduMandala`, `BinduSuccessionFlowCanvas` и визуальные ветки практик. Парная запись: `docs/02_modules/bindu/dependencies.md` §2.

- **`infra`**  
  Expo Router, Supabase-клиент для каталога асан и для **`services/practiceSessions.ts`** (`practice_sessions`, `user_daily_stats`).

- **`remote-play`**
  Карточка асаны (`PracticeCard`, и в каталоге, и в коммуникаторе) несёт кнопку **«Открыть на ТВ»**, чья логика инкапсулирована в хуке **`useAsanaRemotePlayLauncher(strings, launchSource)`** (`modules/practices/ui/useAsanaRemotePlayLauncher.ts`): `vimeoId` валидируется до навигации; `useRemotePlay().connected` false → `router.push({ pathname: "/connect-tv", params: practiceParams })` (после подключения `ConnectTVScreen` предлагает «Начать практику» → `playVimeo` + `/tv-remote`); подключён → `playVimeo(vimeoId, vimeoAudiotrackForLocale(locale))` + `router.push("/tv-remote", { …practiceParams })`. `practiceParams` = `{ vimeoId, title, durationSec, audiotrack, practiceId, slug, chakraIds (через запятую), launchSource }` — пробрасываются через весь ТВ-путь (включая `ConnectTVScreen.startPractice` и `TVRemoteScreen.disconnect`), чтобы `TVRemoteScreen.confirmFinish` мог записать `practice_sessions` с `playback_mode: "tv"` **только при досмотре** (`elapsedSec >= durationSec * 0.95`). Каталог передаёт `launchSource: "catalog"`, коммуникатор — `"assistant"` (второй аргумент хука). `app/asana-practice.tsx` больше не использует `useRemotePlay()` — экран стал телефонным плеером, выбор «телефон/ТВ» перенесён на уровень карточки. Контракт `tv_sessions` (статусы `waiting/playing/paused/stopped/closed`, `pairing_code`, `audiotrack`, `expires_at`, Realtime) описан в `docs/remote-play/README.md`; колонка `locale` удалена миграцией `20260705203000_remote_play_drop_locale.sql`. Провайдер получил `disconnect()` (best-effort stop + локальный сброс сессии) для кнопки «Отключить ТВ» на `/tv-remote` (роут — обычный push `headerShown: false`, шелл `StackScreenLayout` + `StackScrollView` + `SurfaceCardView`; `ModalScreenLayout` на устройстве не рендерил `<Text>`). Парная запись: `docs/02_modules/remote-play/dependencies.md` §2 (после добавления модуля в MAP).

- **`i18n`**  
  `getPracticeCatalogStrings(locale)` (typed gate + overlays; поля `durationMinUnit`, `durationFromPrefix`, `practiceCountOne` / `practiceCountWithTotal` / `catalogFooterTemplate`); `catalog.ts` — `asContentLocale` / `inlineBaseLocale` / `SOURCE_LOCALE` для jsonb-полей йоги; `PracticeCard` / `PracticeCatalogScreen` — `useAppLocale().locale`. Парная запись: `docs/02_modules/i18n/dependencies.md` §2.

- **`affirmations`**  
  `PracticeCatalogScreen` монтирует **`AffirmationWidget`** в listHeader **только** для группы `breath` (Master / `FeatureKey affirmations`). `CoherenceBreathScreen` монтирует **`AffirmationBreathOverlay`** поверх дыхания; day bump через `practice-complete`. Парная запись: `docs/02_modules/affirmations/dependencies.md`.

## 2. От него зависят

- **`audio`**  
  Дыхательный сценарий монтирует звук из practices-потока (`breath-coherence` → `CoherenceBreathScreen` → `MandalaSoundProvider`). **`PlannedCycle`** импортируется в `mandala-sound` из **`modules/breath`**. Парная запись: `docs/02_modules/audio/dependencies.md` §1 и §2.

- **`profile`**  
  `app/(tabs)/profile.tsx` при `canUseFeature("stats")` вызывает **`loadDailyPracticeStatsInRange`** из `services/practiceSessions.ts` (календарное окно). Парная запись: `docs/02_modules/profile/dependencies.md` §1.

- **`assistant`**  
  Серверный диалог подмешивает каталог/выбор практики (`practiceSelection.ts` — localized `name` via `getCoherenceBreathStrings` / `getPracticeCatalogStrings` + `context.user.locale`; **`route.ts`** с импортом **`@shared/assistantSelectableDurations`** — `_legacy_web/shared_core/assistantSelectableDurations.ts`, копия клиентского **`assistantSelectableDurations.ts`** — для карточки, маркеры в промптах); клиентский **`Communicator`** / **`services/communicator-client.ts`** типизирует `practicePicked` и использует общий `PracticeCard` + `launchPractice`. Детализация промптов и оркестратора — в `docs/02_modules/assistant/` (модуль `assistant` заявляет зависимость на `02_modules/practices/spec` в YAML).

- **`communicator` / вкладка «День»**  
  `modules/communicator/ui/Communicator.tsx` импортирует `scheduleAssistantOverlayDismiss`; route-обёртки практик — `useAssistantPracticeOverlayDismiss`. `services/dayHealthContext.ts` читает `user_daily_stats` и завершённые практики дня из `DayPlan`, чтобы перед summary-веткой передать ассистенту временный контекст йоги: сколько минут/практик было сегодня и выше/ниже ли это обычной практики пользователя. Дополнительно breath results теперь вызывают `services/breathPracticeInterpretation.ts` → `POST /api/communicator/v2/practice-interpretation`: тот же `outcomeToCommunicatorPayload(...)` интерпретируется локально в results-modal через STANDARD-модель, без навигации на home/overlay communicator.

## 3. Контрактные точки риска

- **`practice_sessions`**: смена имён/типов колонок, `metrics` или `context` ломает профиль, ассистент и серверные запросы истории (`practiceSelection.ts` читает `practice_id` / `practice_slug` / join на `practices.kind`).

- **`FeatureKey`** (`practice_catalog`, `asana_practices`, `stats`) должна оставаться согласованной с `modules/access` и серверными проверками.

- **`PracticeLaunchParams` vs query**: несовпадение имён параметров роутов (`practiceId`, `durationMs`, `chakra`, `soundBed`, `tempo`, `sensorMode`, `deviceId`, `deviceName`, `provider`, `capabilityTier`, `connectionHint`, `autoReconnect`, legacy `usePulseSensor`) ломает диплинки из каталога и из ассистента.
- **Общий `PracticeCard`**: любое сужение пропсов/типов `PracticeSummary`, `PracticeLaunchParams`, `PracticeVideoMetadata` теперь одновременно затрагивает каталог и communicator.

- **Два источника дефолта длительности медитации** (каталог vs экран) — риск UX при смешанных входах; см. `history.md`.

- **`user_practice_preferences`**: логика триггера завязана на непустой **`practice_id`**; поведение для дыхания/медитации без UUID легко забыть при изменении записи сессий.
