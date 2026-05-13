---
id: 02_modules/communicator/spec
title: Communicator Spec
version: 2.0
updated: 2026-05-13
depends_on: [01_foundation/architecture, 02_modules/assistant/spec]
code_refs:
  [
    modules/communicator/ui/Communicator.tsx,
    modules/communicator/ui/AssistantBubble.tsx,
    modules/communicator/core/transcriptionGuard.ts,
    modules/communicator/ui/StreamingAssistantLines.tsx,
    modules/communicator/api/communicator-stream.ts,
    modules/communicator/ui/useCommunicatorStream.ts,
    modules/practices/ui/PracticeCard.tsx,
    services/communicator-client.ts,
    services/communicatorConfig.ts,
  ]
---

## 1. Назначение

Модуль **communicator** — клиентский слой диалога с ассистентом: UI чата (голос и текст), локальное состояние сессии, разбор SSE-ответа сервера, dev-export диалога и карточка предложенной практики. Серверные промпты, structured Gemini request, оркестратор и выбор практики описаны в `docs/02_modules/assistant/`; здесь зафиксировано только то, что выполняет приложение Expo.

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
  - `onPracticePicked?: (practice: PracticePicked) => void` — вызывается после локального `launchPractice(...)`, не при получении SSE.
  - `onError`, `onAbort`, `onStateChange`, `onEmotionSegment` — см. `CommunicatorProps` в коде.
  - `locale`, `initialMode`, `mode` — локаль строк и политика VOICE/TXT (часть режимов завязана на флаг `COMMUNICATOR_TEXT_MODE_ENABLED` в `modules/ui/testMode`).

- Локальной карточки практики в `communicator` больше нет: используется общий **`modules/practices/ui/PracticeCard.tsx`** через адаптацию `PracticePicked → PracticeSummary`.

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

- `sendDialogMessage(params: SendDialogMessageParams): Promise<SendDialogMessageResult>` — POST с телом JSON, ответ читается как **SSE**: на **web** — `fetch` + потоковое чтение `body`, на **iOS/Android** — **`XMLHttpRequest`** с инкрементальным `responseText` (иначе RN часто отдаёт весь поток одним куском в конце).
- `fetchDialogSession({ useCase, entrySource, scenarioId?, signal? })` — GET синхронизации сессии; при ошибке «нет эндпоинта» для старых серверов возвращается пустая сессия с `reset: true`.
- `transcribeCommunicatorAudio(req)` — POST на `/api/communicator/v2/transcribe` (тело `{ audio: { mimeType, base64 }, language }`).
- `extractCalibration(req)` — используется экраном калибровки, не `Communicator.tsx`.

Типы: `DialogueUseCase`, `DialogueEntrySource`, `PracticePicked`, `OrchestratorDecision`, `DialogCompleteEvent`, `SendDialogMessageParams`, и др. — см. файл.

**`PracticePicked`** — `Partial<PracticeRecommendation> & Pick<PracticeRecommendation, "id">` (реэкспорт контракта каталога практик).

## 3. Внутренняя архитектура

1. **Жизненный цикл сессии** — `Communicator` монтируется → `fetchDialogSession` подтягивает `conversationId` и сообщения с сервера (или подставляет `history` из пропсов); при восстановлении истории фильтруются assistant-сообщения с пустым `content` (защита от серверных артефактов) → пользователь вводит текст или записывает голос.
2. **Голос** — `expo-av` `Audio.Recording` с пресетами из `core/whisperRecording.ts` (16 kHz mono AAC как основной путь, fallback 44.1 kHz) → файл читается как base64 → **`transcribeCommunicatorAudio`** → текст попадает в тот же путь, что и ручной ввод. Запись отправляется только если длительность удержания **≥ `MIN_VOICE_MS`** (450) и размер файла не пустой. После расшифровки строки, совпадающие с известными **галлюцинациями Whisper** на тишине (например субтитровые шаблоны), отбрасываются в `transcriptionGuard.ts` — сообщение **не** добавляется в чат (аналог «пустого» тапа). При низкой уверенности распознавания показывается экран правки текста (`pendingTranscript`).
3. **Стрим ответа** — `runCommunicatorStream` → `sendDialogMessage` парсит SSE-блоки (`parseSseBlock`) и для событий `orchestrator_decision`, `chunk`, `complete` обновляет состояние. На нативных платформах чанки чаще приходят по мере генерации (**XHR** + polling `responseText`). Список сообщений — **`@shopify/flash-list` (`FlashList`)**; активный стрим — последняя строка данных `kind: "stream"`. Пока текста нет — в пузыре **`ActivityIndicator`**; с первого символа после `stripStreamingMarkers` — **`StreamingAssistantLines`**: строки по `\n` с лёгким **`FadeIn`** (`react-native-reanimated`), последний незавершённый сегмент обновляется по мере чанков; курсор **▍** при `streamStatus === "typing"` и непустом хвосте. **Добавление финального сообщения в `messages` и `resetChatStream()` откладываются** до совпадения stripped-текста с целевой строкой (`pendingRevealGoal`) + короткая задержка в компоненте, иначе карточка практики и финальный пузырь «съедали» бы анимацию. Очень короткие ответы (порог после `stripStreamingMarkers`) коммитятся сразу; таймаут принудительного коммита **60 с**. При `complete` итог — `complete.fullText` (sanitized); иначе агрегат SSE после `stripStreamingMarkers`; пусто — `emptyAssistantReplyFallback`.
   **Скролл:** при старте стрима выполняется **`scrollToIndex`** к строке стрима с `viewPosition ≈ 0.3`, чтобы верх пузыря оказался в верхней трети вьюпорта («статичный якорь»). Пока `streamBusy`, **автоскролл в конец при росте контента отключён** (пользователь читает без «погони» за низом). Вне стрима при росте контента и если пользователь не ушёл вверх — как раньше догон вниз через `onContentSizeChange` + `scrollToEnd`; кнопка «Scroll Down» при ручном скролле вверх.
4. **Карточка практики** — `Communicator` рендерит общий `modules/practices/ui/PracticeCard.tsx`, переводя серверный `PracticePicked` в `PracticeSummary`. Текст описания в карточке приходит с сервера уже **кратким** (`reason` в `practice_picked`, см. `assistant` / `practiceCardSummary.ts`). Для breath/meditation пользователь может переопределить duration/chakra перед запуском; затем вызывается `launchPractice(..., { launchSource: 'assistant' })`.
5. **Dev export** — в `__DEV__` показывается кнопка `Export dialog to JSON`, которая собирает `day_context` из `triggerMeta` и метаданные сообщений (`turnMode`, `modelTier`, `validation`, `insightMetrics`) и отдаёт их через RN `Share`.

Готовые реплики ассистента в списке истории рендерятся **`AssistantBubble`** без служебной строки фазы оркестратора (ранее `phaseLabel` из `turnMode`).

События SSE обрабатываются в `handleSseEvent` (`services/communicator-client.ts`): для `complete` в состояние попадает весь объект **`DialogCompleteEvent`**.

## 4. Конфигурация и параметры

| Источник | Назначение |
| --- | --- |
| `EXPO_PUBLIC_COMMUNICATOR_API_URL` (и fallback `EXPO_PUBLIC_BACKEND_API_URL`) | Origin Vercel без суффикса `/api`; см. `services/communicatorConfig.ts`. Отсутствие переменной — ошибка при первом запросе. |
| URL диалога | `getAiDialogUrl()` если в запросе передан **`scenario_id`**, иначе `getCommunicatorV2DialogUrl()`. Текущий **`Communicator`** не передаёт `scenarioId` в `runChatStream` — главный поток всегда использует **v2 dialog URL**. |
| `sendDialogMessage` body | `scenario_id`, `conversationId`, `useCase`, `entrySource`, `triggerMeta`, `userMessage`, `userTimezone`. |
| Константы UI | `MIN_VOICE_MS` (450), `LOW_TRANSCRIPTION_CONFIDENCE` (0.65), лимит текста 8000 символов. |
| Режим текста | `COMMUNICATOR_TEXT_MODE_ENABLED` — если выключен, только голос без переключателя. |
| Дебаг | Подпись `model: …` у бейджа ассистента и кнопка `Export dialog to JSON` — только в **`__DEV__`**. |
| Ошибки сети / LLM | Текст перегрузки Gemini (503/429 и т.п.) в `Alert` нормализуется к короткому русскому сообщению, без сырого стектрейса SDK. |

Из **`complete`** (`DialogCompleteEvent`) в UI и метаданные сообщения попадают как минимум:

- `fullText`, `shouldClose`, `modelUsed`, `modelTier`, `turnMode`, `iteration`, `readyMarkerTriggered`, `validation`, `insightMetrics`
- `messageId`, `conversationId` — обновление id сообщения и активной беседы
- `practicePicked` → `meta.practicePicked` и общий `PracticeCard`; **всегда** содержит `overrides: { durationMin, chakraIndex }` (с fallback-цепочкой на сервере: marker → inferred → planet_of_the_day/null) и опционально `markerIdResolved: false` (если model-generated id не найден в каталоге); `Communicator` прокидывает `overrides` в `PracticeCard` через `overrideDurationMinutes` / `overrideChakraIndex`. Поле **`reason`** — краткий текст карточки с сервера (`practiceCardSummary.ts`), не длинный текст из маркера модели.
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
