---
id: 02_modules/communicator/dependencies
title: Communicator Dependencies
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/assistant/spec]
code_refs:
  [
    modules/communicator/ui/Communicator.tsx,
    modules/communicator/ui/PracticeCard.tsx,
    services/communicator-client.ts,
    app/(tabs)/index.tsx,
    app/calibration.tsx,
  ]
---

## 1. Зависит от

- **`assistant`** (контракт API, не импорт модулей)  
  `services/communicator-client.ts` — POST диалога и SSE (`sendDialogMessage`), GET сессии (`fetchDialogSession`). Поведение эндпоинтов и формат событий описаны в `docs/02_modules/assistant/`.

- **`infra`**  
  `requireSupabase()` для Bearer JWT; `services/communicatorConfig.ts` — базовый URL (`EXPO_PUBLIC_COMMUNICATOR_API_URL`), сбор путей `/api/communicator/v2/dialog`, `/api/communicator/v2/transcribe`, `/api/ai/dialog` и др.

- **`profile`** (через auth)  
  `modules/communicator/ui/Communicator.tsx` — `useAuth()` / `profile` для подписи уровня доступа к модели в dev/test (`tierLabelFromProfile`), не для гейтинга функций.

- **`practices`**  
  `PracticePicked` основан на `PracticeRecommendation` (`services/communicator-client.ts`, `modules/communicator/core/types.ts`).  
  `modules/communicator/ui/PracticeCard.tsx` — типы превью видео из `modules/practices/core/types`, загрузка превью Vimeo через `services/practice-thumbnails.ts` (`fetchPracticeVimeoThumbnail`).

- **`subscription`** (интеграция на точке входа, не внутри `modules/communicator/*`)  
  `app/(tabs)/index.tsx` — перед открытием оверлея ассистента проверяется `canUseFeature("assistant_dialog")`; при отказе показывается `UpgradeDialog`. Сам компонент `Communicator` модуль доступа не импортирует.

## 2. От него зависят

- **`calibration`**  
  `app/calibration.tsx` — `transcribeCommunicatorAudio`, `extractCalibration` из `services/communicator-client.ts` (тот же транспорт и авторизация, что и у диалога). UI диалога ассистента не переиспользуется.

- **`practices`** (потребление DTO и запуск)  
  Карточка использует контракт рекомендации; на главном экране `launchPracticeFromAssistant` (`app/(tabs)/index.tsx`) маппит `PracticePicked` на маршруты практик (`launchPractice`).

- **Приложение (home)**  
  `app/(tabs)/index.tsx` — `CommunicatorOverlay` оборачивает `Communicator` в полноэкранный `Modal`, передаёт прогноз дня в `triggerMeta`, начальное сообщение ассистента в `history`, `onPracticePicked` → закрытие оверлея и запуск практики.

- **`modules/breath`** (опциональная очередь)  
  `modules/breath/ui/CoherenceBreathScreen.tsx` вызывает `enqueueCommunicatorGreeting` из `modules/communicator/core/pending-greeting.ts` перед переходом на главный экран. Потребление очереди на стороне home не зафиксировано в коде главного экрана — см. `docs/04_workspace/open_questions.md` (раздел `communicator`).

## 3. Контрактные точки риска

- **Имена SSE-событий** — клиент ожидает ровно `orchestrator_decision`, `chunk`, `complete`; рассинхрон с сервером сломает стрим без явной ошибки.
- **`PracticePicked`** — расширение/сужение полей на сервере ломает `PracticeCard` и `launchPracticeFromAssistant` (маршруты, slug vs id).
- **`triggerMeta.systemPrompt`** — `Communicator` вкладывает переданный снаружи `systemPrompt` в объект метаданных; смена контракта бэкенда к этому ключу потребует правок UI и сервера согласованно.
- **`fetchDialogSession` fallback** — при 404/405 клиент возвращает пустую сессию с `reset: true`; иначе ошибка пробрасывается в `Alert`.
