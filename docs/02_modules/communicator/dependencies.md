---

id: 02_modules/communicator/dependencies
title: Communicator Dependencies
version: 1.9
updated: 2026-05-25
depends_on: [01_foundation/architecture, 02_modules/assistant/spec]
code_refs:
  [
    modules/communicator/ui/Communicator.tsx,
    modules/communicator/ui/AssistantBubble.tsx,
    modules/communicator/core/voiceTurnPipeline.ts,
    modules/communicator/core/transcriptionGuard.ts,
    modules/communicator/ui/StreamingAssistantLines.tsx,
    services/communicator-client.ts,
    services/dialogSessionCache.ts,
    app/(tabs)/index.tsx,
    app/calibration.tsx,
    modules/practices/ui/PracticeCard.tsx,
    modules/communicator/core/dialogTextCleanup.ts,
    modules/communicator/core/dialogTurnHydration.ts,
  ]
---

## 1. Зависит от

- `**infra**`  
`requireSupabase()` для Bearer JWT; `services/communicatorConfig.ts` — базовый URL (`EXPO_PUBLIC_COMMUNICATOR_API_URL`), сбор путей `/api/communicator/v2/dialog`, `/api/communicator/v2/transcribe`, `/api/ai/dialog` и др. В корневом `**package.json**` клиента — `**@shopify/flash-list**` для списка сообщений в `Communicator.tsx` (виртуализация, `scrollToIndex` к якорю стрима). `**modules/communicator/core/dialogTextCleanup.ts**` — нормализация видимого текста ассистента (убирает утечки `---` и **целиком** блоки `**…`**); дублирует контракт серверного `stripDialogScaffoldMarkdown` в `markers.ts`. `**modules/communicator/core/dialogTurnHydration.ts**` — pure helpers для дополнения `DialogCompleteEvent` из `fetchDialogSession` (`needsAssistantTurnHydration`, `sessionAssistantMatchesTurn`, `mergeCompleteWithSession`); используется в `Communicator.tsx` при неполном SSE `complete`. `**modules/communicator/core/voiceTurnPipeline.ts**` — bounded transcribe/retry и удаление временного файла записи; `Communicator.tsx` импортирует его вместо прямого `transcribeCommunicatorAudio` в UI.
- `**modules/ui**` (i18n ошибок)  
`modules/ui/i18n/userErrors.ts` — строки Alert, в т.ч. **`timeoutTitle`** / **`timeoutMessage`**; потребляется через `services/userFacingErrors.ts` в `Communicator` и на других экранах.
- `**profile**` (через auth)  
`modules/communicator/ui/Communicator.tsx` — `useAuth()` / `profile` для подписи уровня доступа к модели в dev/test (`tierLabelFromProfile`) и для ключа локального session-cache (`profile.id` + `useCase` + `entrySource` + локальная дата в tz устройства через `services/dialogSessionCache.ts`), не для гейтинга функций.
- `**assistant**` (транспорт daily dialog)  
`services/communicator-client.ts` — `sendDialogMessage` передаёт optional `turnHistory` (до 40 ходов, `buildClientTurnHistory`); сервер (`resolveTurnHistory`) предпочитает клиентскую ленту над `messages` в БД, где `content` пустой.
- `**practices**`  
`PracticePicked` основан на `PracticeRecommendation` (`services/communicator-client.ts`, `modules/communicator/core/types.ts`).  
`modules/communicator/ui/Communicator.tsx` импортирует общий `modules/practices/ui/PracticeCard.tsx`, `PracticeSummary`, `PracticeLaunchParams` и `launchPractice(...)`; серверный DTO адаптируется в локальный summary/launch без отдельного communicator-specific UI.
- `**subscription**` (интеграция на точке входа, не внутри `modules/communicator/*`)  
`app/(tabs)/index.tsx` — перед открытием оверлея ассистента проверяется `canUseFeature("assistant_dialog")`; при отказе показывается `UpgradeDialog`. Сам компонент `Communicator` модуль доступа не импортирует.

## 2. От него зависят

- `**calibration**`  
`app/calibration.tsx` — `transcribeCommunicatorAudio`, `extractCalibration` из `services/communicator-client.ts` (тот же транспорт и авторизация, что и у диалога). UI диалога ассистента не переиспользуется.
- `**practices**` (потребление DTO и запуск)  
Карточка использует общий UI каталога; запуск теперь делает сам `Communicator` через `launchPractice(...)`, а `app/(tabs)/index.tsx` больше не содержит отдельный `launchPracticeFromAssistant`.
- **Приложение (home)**  
`app/(tabs)/index.tsx` — `CommunicatorOverlay` оборачивает `Communicator` в полноэкранный `Modal`, передаёт прогноз дня в `triggerMeta` (`chakraLabel`, `harmoniousnessValue`, `harmoniousnessLabel` и др.) и начальное сообщение ассистента в `history`; `onPracticePicked` теперь нужен только для побочных UX-эффектов вроде закрытия оверлея. Dev-сброс дня вызывает `clearHomeDailyDialogCache` из `services/dialogSessionCache.ts` (пара `useCase: daily_dialog`, `entrySource: home`).
- `**modules/breath`** (опциональная очередь)  
`modules/breath/ui/CoherenceBreathScreen.tsx` вызывает `enqueueCommunicatorGreeting` из `modules/communicator/core/pending-greeting.ts` перед переходом на главный экран. Потребление очереди на стороне home не зафиксировано в коде главного экрана — см. `docs/04_workspace/open_questions.md` (раздел `communicator`).

## 3. Контрактные точки риска

- **Имена SSE-событий** — клиент ожидает ровно `orchestrator_decision`, `chunk`, `complete`; рассинхрон с сервером сломает стрим без явной ошибки.
- `**PracticePicked`** — расширение/сужение полей на сервере ломает адаптер `PracticePicked → PracticeSummary` и параметры `launchPractice` (маршруты, slug vs id, chakra/duration override).
- `**triggerMeta.systemPrompt**` — `Communicator` вкладывает переданный снаружи `systemPrompt` в объект метаданных; смена контракта бэкенда к этому ключу потребует правок UI и сервера согласованно.
- `**fetchDialogSession` fallback** — при 404/405 клиент возвращает пустую сессию с `reset: true`; иначе ошибка пробрасывается в `Alert`.
- **Транспорт SSE на native** — `sendDialogMessage` не использует `fetch` для тела диалога на iOS/Android (часто буферизует весь ответ до конца); там `**XMLHttpRequest`**. Парсер блоков (`parseSseBlock` / `handleSseEvent`) общий с web.
- **`turnHistory` / session-cache** — рассинхрон лимита (40), формата ролей или ключа кеша (`localDate` в tz) ломает восстановление daily dialog после перезапуска приложения без server-side текста в `messages.content`.