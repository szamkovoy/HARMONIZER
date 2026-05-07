---
id: 02_modules/communicator/spec
title: Communicator Spec
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/architecture, 02_modules/assistant/spec]
code_refs:
  [
    modules/communicator/ui/Communicator.tsx,
    modules/communicator/ui/PracticeCard.tsx,
    modules/communicator/api/communicator-stream.ts,
    modules/communicator/ui/useCommunicatorStream.ts,
    services/communicator-client.ts,
    services/communicatorConfig.ts,
  ]
---

## 1. Назначение

Модуль **communicator** — клиентский слой диалога с ассистентом: UI чата (голос и текст), локальное состояние сессии, разбор SSE-ответа сервера и карточка предложенной практики. Серверные промпты, оркестратор и выбор практики описаны в `docs/02_modules/assistant/`; здесь зафиксировано только то, что выполняет приложение Expo.

## 2. Публичный контракт

### UI

- **`Communicator`** (`modules/communicator/ui/Communicator.tsx`)  
  `export function Communicator(props: CommunicatorProps): JSX.Element`

  Основные пропсы:

  - `systemPrompt: string` — передаётся на сервер внутри `triggerMeta` вместе с остальными метаданными.
  - `useCase?: DialogueUseCase` — по умолчанию `"daily_dialog"`; для других сценариев см. `services/communicator-client.ts`.
  - `entrySource?: DialogueEntrySource` — по умолчанию `"home"`.
  - `triggerMeta?: Record<string, unknown>` — произвольный контекст для бэкенда (на главном экране туда кладут поля прогноза дня).
  - `conversationId?: string | null` — начальное значение; после ответа может обновиться из события `complete`.
  - `history?: CommunicatorHistoryMessage[]`, `memoryWindow?: number` — начальная история и ограничение числа последних пар для синхронизации/отображения (`sliceHistoryForWindow`).
  - `autoSendInitialMessage?: string` — один раз после успешной `fetchDialogSession` отправляет текст как пользователя (см. ref-guard в коде).
  - `onMessage?: (msg: CommunicatorHistoryMessage) => void`
  - `onPracticePicked?: (practice: PracticePicked) => void` — вызывается из **`PracticeCard`** при нажатии «Начать», не при получении SSE.
  - `onError`, `onAbort`, `onStateChange`, `onEmotionSegment` — см. `CommunicatorProps` в коде.
  - `locale`, `initialMode`, `mode` — локаль строк и политика VOICE/TXT (часть режимов завязана на флаг `COMMUNICATOR_TEXT_MODE_ENABLED` в `modules/ui/testMode`).

- **`PracticeCard`** (`modules/communicator/ui/PracticeCard.tsx`)  
  `export function PracticeCard(props: { practice: PracticePicked; strings: CommunicatorStrings; onPress?: (practice: PracticePicked) => void })`

### Типы модуля (`modules/communicator/core/types.ts`)

- `CommunicatorModePolicy`, `CommunicatorInitialMode`
- `CommunicatorHistoryMessage` — `meta` может содержать `practicePicked`, данные оркестратора и т.д.
- `CommunicatorSessionState`, фазы сессии
- `EmotionSegmentPayload` — задел под передачу сегмента аудио наружу (`onEmotionSegment`)

### Очередь «обсудить из другого экрана» (`modules/communicator/core/pending-greeting.ts`)

- `enqueueCommunicatorGreeting`, `consumeCommunicatorGreeting`, `peekCommunicatorGreeting`, `subscribePendingGreeting`

### Локализация (`modules/communicator/i18n/communicator.ts`)

- `getCommunicatorStrings(locale)`, тип `CommunicatorStrings`

### Поток чата без прямого импорта `sendDialogMessage` в UI

- **`useCommunicatorStream`** — обёртка состояния стрима (thinking/typing, текст, решение оркестратора).
- **`runCommunicatorStream`** (`modules/communicator/api/communicator-stream.ts`) — агрегирует колбэки `sendDialogMessage` в чанки для UI.

### Транспорт (`services/communicator-client.ts`)

Экспортируемые функции и типы, с которыми работают UI и другие экраны:

- `sendDialogMessage(params: SendDialogMessageParams): Promise<SendDialogMessageResult>` — POST с телом JSON, ответ читается как **SSE** (см. ниже).
- `fetchDialogSession({ useCase, entrySource, scenarioId?, signal? })` — GET синхронизации сессии; при ошибке «нет эндпоинта» для старых серверов возвращается пустая сессия с `reset: true`.
- `transcribeCommunicatorAudio(req)` — POST на `/api/communicator/v2/transcribe` (тело `{ audio: { mimeType, base64 }, language }`).
- `extractCalibration(req)` — используется экраном калибровки, не `Communicator.tsx`.

Типы: `DialogueUseCase`, `DialogueEntrySource`, `PracticePicked`, `OrchestratorDecision`, `DialogCompleteEvent`, `SendDialogMessageParams`, и др. — см. файл.

**`PracticePicked`** — `Partial<PracticeRecommendation> & Pick<PracticeRecommendation, "id">` (реэкспорт контракта каталога практик).

## 3. Внутренняя архитектура

1. **Жизненный цикл сессии** — `Communicator` монтируется → `fetchDialogSession` подтягивает `conversationId` и сообщения с сервера (или подставляет `history` из пропсов) → пользователь вводит текст или записывает голос.
2. **Голос** — `expo-av` `Audio.Recording` с пресетами из `core/whisperRecording.ts` (16 kHz mono AAC как основной путь, fallback 44.1 kHz) → файл читается как base64 → **`transcribeCommunicatorAudio`** → текст попадает в тот же путь, что и ручной ввод. При низкой уверенности распознавания показывается экран правки текста (`pendingTranscript`).
3. **Стрим ответа** — `runCommunicatorStream` → `sendDialogMessage` парсит SSE-блоки (`parseSseBlock`) и для событий `orchestrator_decision`, `chunk`, `complete` обновляет состояние. Во время стрима показывается «печатающий» пузырь; после завершения сообщение ассистента добавляется в список; при наличии `practicePicked` в `complete` под ответом рендерится **`PracticeCard`**.
4. **Карточка практики** — только отображение и кнопка; запуск практики выполняет колбэк родителя (на главном экране — через `launchPractice` / маршруты практик).

События SSE обрабатываются в `handleSseEvent` (`services/communicator-client.ts`): для `complete` в состояние попадает весь объект **`DialogCompleteEvent`**.

## 4. Конфигурация и параметры

| Источник | Назначение |
| --- | --- |
| `EXPO_PUBLIC_COMMUNICATOR_API_URL` (и fallback `EXPO_PUBLIC_BACKEND_API_URL`) | Origin Vercel без суффикса `/api`; см. `services/communicatorConfig.ts`. Отсутствие переменной — ошибка при первом запросе. |
| URL диалога | `getAiDialogUrl()` если в запросе передан **`scenario_id`**, иначе `getCommunicatorV2DialogUrl()`. Текущий **`Communicator`** не передаёт `scenarioId` в `runChatStream` — главный поток всегда использует **v2 dialog URL**. |
| `sendDialogMessage` body | `scenario_id`, `conversationId`, `useCase`, `entrySource`, `triggerMeta`, `userMessage`, `userTimezone`. |
| Константы UI | `MIN_VOICE_MS` (450), `LOW_TRANSCRIPTION_CONFIDENCE` (0.65), лимит текста 8000 символов. |
| Режим текста | `COMMUNICATOR_TEXT_MODE_ENABLED` — если выключен, только голос без переключателя. |

Из **`complete`** (`DialogCompleteEvent`) в UI и метаданные сообщения попадают как минимум:

- `fullText`, `shouldClose`, `modelUsed`
- `messageId`, `conversationId` — обновление id сообщения и активной беседы
- `practicePicked` → `meta.practicePicked` и **`PracticeCard`**
- `recommendationCorrected` → `meta.recommendationCorrected`

Поля **`chunk`**: JSON с `text` и опционально `modelUsed`.

## 5. Известные ограничения

- Серверная семантика диалога и выбор практики не дублируются здесь — см. **`docs/02_modules/assistant/spec.md`**.
- Условный выбор URL (`/api/ai/dialog` vs `/api/communicator/v2/dialog`) задан в клиенте; обсуждение техдолга — в `docs/04_workspace/open_questions.md` (раздел `assistant`), не дублировать.
- Калибровочный экран **`app/calibration.tsx`** не использует `Communicator`; только общий транспорт `transcribeCommunicatorAudio` / `extractCalibration`.
- Гейтинг по подписке для основного диалога выполняется на **`app/(tabs)/index.tsx`** (`canUseFeature("assistant_dialog")`), не внутри `Communicator`.

## Справочные материалы

- Параметры записи под Whisper/Hume (16 kHz, mono): **`docs/hume_integration.md`** — согласованы с `core/whisperRecording.ts`.
- Серверный контракт диалога и SSE: **`docs/02_modules/assistant/spec.md`** (без повторения промптов и оркестратора здесь).
- Контракт рекомендации практики в каталоге: **`docs/02_modules/practices/spec.md`** (поля `PracticeRecommendation` / подмножество в `PracticePicked`).
