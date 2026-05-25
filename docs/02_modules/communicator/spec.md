---

id: 02_modules/communicator/spec
title: Communicator Spec
version: 2.19
updated: 2026-05-25
depends_on: [01_foundation/architecture, 02_modules/assistant/spec]
code_refs:
  [
    modules/communicator/ui/Communicator.tsx,
    modules/communicator/ui/AssistantBubble.tsx,
    modules/communicator/core/voiceTurnPipeline.ts,
    modules/communicator/core/transcriptionGuard.ts,
    modules/communicator/core/dialogTurnHydration.ts,
    modules/communicator/core/dialogTextCleanup.ts,
    modules/communicator/ui/StreamingAssistantLines.tsx,
    modules/communicator/api/communicator-stream.ts,
    modules/communicator/ui/useCommunicatorStream.ts,
    modules/practices/core/assistantSelectableDurations.ts,
    services/communicator-client.ts,
    services/dialogSessionCache.ts,
    services/communicatorConfig.ts,
  ]
---

## 1. Назначение

Модуль **communicator** — клиентский слой диалога с ассистентом: UI чата (голос и текст), локальное состояние сессии, разбор SSE-ответа сервера, dev-export диалога и карточка предложенной практики. Серверные промпты, structured Gemini request, оркестратор и выбор практики описаны в `docs/02_modules/assistant/`; здесь зафиксировано только то, что выполняет приложение Expo.

## 2. Публичный контракт

### UI

- `**Communicator**` (`modules/communicator/ui/Communicator.tsx`)  
`export function Communicator(props: CommunicatorProps): JSX.Element`
  Основные пропсы:
  - `systemPrompt: string` — передаётся на сервер внутри `triggerMeta` вместе с остальными метаданными.
  - `useCase?: DialogueUseCase` — по умолчанию `"daily_dialog"`; для других сценариев см. `services/communicator-client.ts`.
  - `entrySource?: DialogueEntrySource` — по умолчанию `"home"`.
  - `triggerMeta?: Record<string, unknown>` — произвольный контекст для бэкенда (на главном экране туда кладут поля прогноза дня).
  - `conversationId?: string | null` — начальное значение; после ответа может обновиться из события `complete`.
  - `history?: CommunicatorHistoryMessage[]`, `memoryWindow?: number` — начальная история и ограничение числа последних пар для синхронизации/отображения (`sliceHistoryForWindow`).
  - `autoSendInitialMessage?: string` — один раз после локального восстановления/инициализации сессии отправляет текст как пользователя (см. ref-guard в коде).
  - `onMessage?: (msg: CommunicatorHistoryMessage) => void`
  - `onPracticePicked?: (practice: PracticePicked) => void` — вызывается после локального `launchPractice(...)`, не при получении SSE.
  - `onError`, `onAbort`, `onStateChange`, `onEmotionSegment` — см. `CommunicatorProps` в коде.
  - `locale`, `initialMode`, `mode` — локаль строк и политика VOICE/TXT (часть режимов завязана на флаг `COMMUNICATOR_TEXT_MODE_ENABLED` в `modules/ui/testMode`).
- Локальной карточки практики в `communicator` больше нет: используется общий `**modules/practices/ui/PracticeCard.tsx**` через адаптацию `PracticePicked → PracticeSummary`.

### Типы модуля (`modules/communicator/core/types.ts`)

- `CommunicatorModePolicy`, `CommunicatorInitialMode`
- `CommunicatorHistoryMessage` — `meta` может содержать `practicePicked`, данные оркестратора, **`voiceTranscribing?: boolean`** (плейсхолдер голоса до текста) и т.д.
- `CommunicatorSessionState`, фазы сессии
- `EmotionSegmentPayload` — задел под передачу сегмента аудио наружу (`onEmotionSegment`)

### Очередь «обсудить из другого экрана» (`modules/communicator/core/pending-greeting.ts`)

- `enqueueCommunicatorGreeting`, `consumeCommunicatorGreeting`, `peekCommunicatorGreeting`, `subscribePendingGreeting`

### Локализация (`modules/communicator/i18n/communicator.ts`)

- `getCommunicatorStrings(locale)`, тип `CommunicatorStrings` (в т.ч. **`voiceUserBubblePending`** — строка для доступности плейсхолдера голоса; **`voiceTranscribeFailedBubble`** — текст в пузыре при сбое расшифровки).

### Голосовой пайплайн (`modules/communicator/core/voiceTurnPipeline.ts`)

- `transcribeVoiceRecording({ uri, language, signal? })` — до **`VOICE_TRANSCRIBE_MAX_ATTEMPTS`** (3) попыток по **`VOICE_TRANSCRIBE_ATTEMPT_MS`** (10 с) каждая; внутри вызывает `transcribeCommunicatorAudio` с `{ useNetworkRetry: false }`.
- `deleteVoiceRecordingFile(uri)`, тип **`RetainedVoiceRecording`** (URI, длительность, опционально `transcribedText`, `pendingVoiceId`).

### Ошибки сети и UX (`services/userFacingErrors.ts`, `modules/ui/i18n/userErrors.ts`)

- Транзиентные `Network request failed` в API-клиентах: до **2** скрытых повторов (`withTransientNetworkRetry`), затем Alert с текстом из **`getUserErrorStrings(locale)`** (ru/en) — без URL в UI.
- Классификация **`timeout`** (сообщения transcribe/стрима с `timed out` и т.п.) → **`timeoutTitle`** / **`timeoutMessage`**, retryable.
- **`Communicator`**: кнопки **Повторить** / **Закрыть** при сетевых и 503/429 ошибках; повтор вызывает последний `initiateDialog` или `submitDialogTurn` без дублирования пузыря пользователя.
- Технические детали — только в `console` через `logErrorForDevelopers`.

### Очистка видимого текста ассистента (`modules/communicator/core/dialogTextCleanup.ts`)

- **`stripDialogScaffoldMarkdown(text): string`** — экспорт; зеркалит серверный одноимённый helper в `_legacy_web/app/api/_utils/markers.ts`.
- **`stripStreamingMarkers`** в `Communicator.tsx` — локальный regex `MARKER_RE` вырезает из видимого стрима `[STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|MATRIX_CELLS:…]` и `[PLAN_TOMORROW]` до применения `stripDialogScaffoldMarkdown`.

### Гидрация `complete` из session sync (`modules/communicator/core/dialogTurnHydration.ts`)

- **`isFinalLikeTurnMode(turnMode)`** — `fast_track_final`, `final_recommendation`, `final_recommendation_with_validation_warning`, `forced_final`.
- **`needsAssistantTurnHydration(complete)`** — `true`, если `complete` отсутствует, в нём нет `turnMode` / `modelTier` / `modelUsed` / `iteration`, либо режим final-like без `practicePicked`.
- **`sessionAssistantMatchesTurn({ currentText, currentMessageId?, sessionText, sessionMessageId? })`** — совпадение по `messageId` или по trimmed-тексту (пустой `currentText` считается совпадающим).
- **`mergeCompleteWithSession({ complete, sessionMeta, sessionText, sessionMessageId? })`** → `DialogCompleteEvent` — дополняет пропущенные поля из `meta` последнего assistant-сообщения сессии.
- Тип **`SessionAssistantTurnMeta`** — подмножество полей `complete` / `meta` для merge.

`Communicator.tsx` вызывает эти helpers в `commitAssistantTurn` на success-path (когда текст есть, а `complete` неполон) и при восстановлении после обрыва SSE.

### Поток чата без прямого импорта `sendDialogMessage` в UI

- `**useCommunicatorStream()**` — обёртка состояния стрима (thinking/typing, текст, решение оркестратора); без колбэка `onError`. При исключении после частичного SSE возвращает salvaged-чанк, если уже есть `complete` или непустой агрегат текста; иначе пробрасывает ошибку.
- `**runCommunicatorStream**` (`modules/communicator/api/communicator-stream.ts`) — агрегирует колбэки `sendDialogMessage` в чанки для UI.

### Транспорт (`services/communicator-client.ts`)

Экспортируемые функции и типы, с которыми работают UI и другие экраны:

- `sendDialogMessage(params: SendDialogMessageParams): Promise<SendDialogMessageResult>` — POST с телом JSON, ответ читается как **SSE**: на **web** — `fetch` + потоковое чтение `body`, на **iOS/Android** — `**XMLHttpRequest**` с инкрементальным `responseText` (иначе RN часто отдаёт весь поток одним куском в конце).
- `fetchDialogSession({ useCase, entrySource, scenarioId?, conversationId?, debugExport?, signal? })` — GET синхронизации сессии; используется как fallback для гидрации `complete`, dev-export и debug-снимка сервера, но **не** как канонический источник текста текущего daily dialog. Опционально `debugExport: true` → query `debugExport=1` и поле `dialogStateAfter` в ответе при серверном test/debug режиме; опционально `conversationId` запрашивает конкретную беседу по id, даже если она уже закрыта. При ошибке «нет эндпоинта» для старых серверов возвращается пустая сессия с `reset: true`.
- `transcribeCommunicatorAudio(req, options?: { useNetworkRetry?: boolean })` — POST на `/api/communicator/v2/transcribe` (тело `{ audio: { mimeType, base64 }, language }`); таймаут одной попытки **12 с** (`TRANSCRIBE_TIMEOUT_MS`). По умолчанию — `withTransientNetworkRetry`; голосовой пайплайн передаёт `useNetworkRetry: false` (повторы на уровне `transcribeVoiceRecording`).
- `extractCalibration(req)` — используется экраном калибровки, не `Communicator.tsx`.

Типы: `DialogueUseCase`, `DialogueEntrySource`, `PracticePicked`, `OrchestratorDecision`, `DialogCompleteEvent`, `SendDialogMessageParams`, `DialogTurnHistoryItem`, и др. — см. файл. `**buildClientTurnHistory**` / `DIALOG_TURN_HISTORY_LIMIT` (40) собирают `turnHistory` из локальной ленты перед POST.

`**PracticePicked**` — `Partial<PracticeRecommendation> & Pick<PracticeRecommendation, "id">` (реэкспорт контракта каталога практик).

`**DialogCompleteEvent**` — кроме `fullText` / `turnMode` / `practicePicked` может нести и контекст ветвления финального хода: `branches`, `phaseTime`, `targetChakra`; клиент сохраняет эти поля в `messages.meta` и dev-export.

## 3. Внутренняя архитектура

1. **Жизненный цикл сессии** — `Communicator` монтируется → локально загружает current-day session-cache (`services/dialogSessionCache.ts`) по ключу `userId + useCase + entrySource`; если кеш валиден, восстанавливаются `conversationId` и видимая лента сообщений, если нет — берётся `history` из пропсов и начинается новый daily dialog. Закрытый диалог (`shouldClose`) сразу удаляется из локального кеша, поэтому communicator не показывает завершённые беседы как историю «на весь день». `fetchDialogSession(...)` остаётся только fallback-источником для гидрации метаданных / dev-export.
2. **Голос** — `expo-av` `Audio.Recording` с пресетами из `core/whisperRecording.ts` (16 kHz mono AAC как основной путь, fallback 44.1 kHz) → URI записи удерживается в `retainedVoiceRef` до успешного ответа ассистента (`core/voiceTurnPipeline.ts`: `transcribeVoiceRecording` — до **3** попыток по **10 с** каждая, без минутного зависания спиннера) → текст попадает в тот же путь, что и ручной ввод. При сбое расшифровки пузырь остаётся с текстом `voiceTranscribeFailedBubble`; Alert **Повторить** повторно отправляет тот же файл. После успешного `commitAssistantTurn` временный файл удаляется (`deleteVoiceRecordingFile`). При сбое диалога после расшифровки **Повторить** вызывает только `submitDialogTurn` с сохранённым текстом. Запись отправляется только если длительность удержания **≥ `MIN_VOICE_MS**` (450) и размер файла не пустой. Сразу в `processVoiceFromUri` в `messages` добавляется строка пользователя с `**meta.voiceTranscribing: true**` и пустым `content`: `**UserBubble**` показывает только `**ActivityIndicator**` (для доступности — `**voiceUserBubblePending**` без видимого текста); после успешной расшифровки та же строка заменяется текстом. `**scrollToIndex**` к этому пузырю с `**viewPosition ≈ 0.24**` срабатывает при **инкременте** `voiceAnchorTick` (плейсхолдер и финальный текст); вызов откладывается до измерения layout у `**FlashList**` (двойной `requestAnimationFrame` + короткая задержка) и **повторяется** по `Promise` при отказе (без `scrollToEnd` в `catch`); эффект **не** блокируется `streamBusy`. Повтор на каждый чанк стрима не помечается успешным (`lastVoiceLayoutScrollTickRef` только после успешного скролла). Пока `voiceUserAnchorMessageIdRef` задан, `**onContentSizeChange**` не вызывает `scrollToEnd`, чтобы «догон низа» не перебивал якорь. При `**streamBusy**` авто-`**scrollToIndex**` к строке стрима ассистента **не** вызывается (`suppressStreamAnchorScroll`), чтобы окно не уезжало при длинном ответе; флаг **сбрасывается**, когда `streamBusy` переходит из **`true`** в **`false`**, чтобы следующий стрим снова мог якориться к пузырю стрима. `**stripLegacyPracticeCardReason**` в `Communicator.tsx` обрезает устаревшие хвосты в `**practicePicked.reason**` (в т.ч. из сохранённой сессии). После расшифровки строки, совпадающие с известными **галлюцинациями Whisper** на тишине (например субтитровые шаблоны), отбрасываются в `transcriptionGuard.ts` — плейсхолдер **удаляется**, в чат текст не попадает. При низкой уверенности распознавания плейсхолдер снимается и показывается экран правки текста (`pendingTranscript`).
3. **Стрим ответа** — `runCommunicatorStream` → `sendDialogMessage` парсит SSE-блоки (`parseSseBlock`) и для событий `orchestrator_decision`, `chunk`, `complete` обновляет состояние. На нативных платформах чанки чаще приходят по мере генерации (**XHR** + polling `responseText`); при `xhr.onerror` после закрытия сокета клиент **финализирует** буфер и **resolve**, если уже есть `complete` или непустой `fullText` (типичный iOS/RN артефакт при успешно принятом теле). Список сообщений — `**@shopify/flash-list` (`FlashList`)**; активный стрим — последняя строка данных `kind: "stream"`. Пока текста нет — в пузыре `**ActivityIndicator**`; с первого символа после `stripStreamingMarkers` + `**stripDialogScaffoldMarkdown**` (убирает `---` и **целиком** блоки `**…**`, без разворачивания в видимый текст) — `**StreamingAssistantLines**`: строки по `\n` с лёгким `**FadeIn**` (`react-native-reanimated`), последний незавершённый сегмент обновляется по мере чанков; курсор **▍** при `streamStatus === "typing"` и непустом хвосте. Финальный коммит в историю — через **`commitAssistantTurn`** (общий для `submitDialogTurn` и `initiateDialog`). **Добавление финального сообщения в `messages` и `resetChatStream()` откладываются** до совпадения stripped-текста с целевой строкой (`pendingRevealGoal`) + короткая задержка в компоненте, иначе карточка практики и финальный пузырь «съедали» бы анимацию. Этот отложенный путь включается только если агрегат стрима **`mergedText`** после trim **непуст**, ответ **не** восстановлен через session hydration, длина после strip > **14**, и в **`complete` нет `practicePicked`**; если **`practicePicked` пришёл** — коммит **сразу** (карточка не должна ждать reveal). Перед отложенным коммитом **`syncDisplayText(finalText)`** выравнивает live-стрим с sanitized `complete.fullText`, иначе `stripTarget` (сырые SSE-чанки) и `revealGoal` (серверный sanitized) расходятся и flush не срабатывает до таймаута **60 с**. Очень короткие ответы (порог после strip, **14** символов) коммитятся сразу; таймаут принудительного коммита **60 с**. Если `complete` отсутствует, неполон или не содержит `practicePicked` на финальном ходе, клиент делает несколько попыток `**fetchDialogSession**` (backoff ~0.7/1.4/2.6 s), сверяет последнюю assistant-реплику с локальным текстом и догидрирует `turnMode`, `modelTier`, `modelUsed`, `iteration`, `practicePicked`, `branches`, `phaseTime`, `targetChakra`, `debug`. Тот же механизм используется и после исключения стрима. При `complete` итог — `complete.fullText` (sanitized); иначе агрегат SSE после `stripStreamingMarkers` + `stripDialogScaffoldMarkdown`; пусто — `emptyAssistantReplyFallback`.
  **Скролл:** при старте стрима выполняется `**scrollToIndex**` к строке стрима с `viewPosition ≈ 0.3` (если **не** включён `**suppressStreamAnchorScroll**` после голосового ввода), чтобы верх пузыря оказался в верхней трети вьюпорта («статичный якорь»). Пока `streamBusy`, **автоскролл в конец при росте контента отключён** (пользователь читает без «погони» за низом). Вне стрима при росте контента и если пользователь не ушёл вверх — как раньше догон вниз через `onContentSizeChange` + `scrollToEnd`; кнопка «Scroll Down» при ручном скролле вверх.
4. **Карточка практики** — `Communicator` рендерит общий `modules/practices/ui/PracticeCard.tsx`, переводя серверный `PracticePicked` в `PracticeSummary`. Текст описания в карточке берётся из `**practicePicked.card_blurb`** (если сервер прислал валидированный model-generated blurb) либо из `**reason`** как fallback/legacy-совместимость. Для **йоги** `overrideDurationMinutes` / `overrideChakraIndex` **не** передаются (значения каталога); для breath/meditation пользователь может переопределить duration/chakra перед запуском; **`PracticeCard`** клипит `overrideDurationMinutes` к допустимым шагам каталога (см. `assistantSelectableDurations.ts`, тот же контракт, что и сервер в `resolvePracticePublic`); затем вызывается `launchPractice(..., { launchSource: 'assistant' })`.
5. **Dev export** — в `__DEV__` показывается кнопка `Export dialog to JSON`, которая собирает `day_context` из `triggerMeta`, верхнеуровневый блок `conversation` (`conversation_id`, `use_case`, `entry_source`) и метаданные сообщений (`turnMode`, `modelTier`, `validation`, `practicePicked`, `branches`, `phaseTime`, `targetChakra`, `insightMetrics`, **`planning_persistence`**). Каноническим источником видимого текста теперь считается **локальный current-day session-cache**, а server session sync через `fetchDialogSession({ debugExport: true })` используется как источник `meta` и `dialog_state_after`. Поэтому export по-прежнему сохраняет **весь видимый текст диалога**, даже если на сервере тексты не лежат в `messages.content`. При активном server test/debug режиме export также включает `dialog_state_after` (снимок forecast/planned_events/daily_matrix + context/summary через GET `?debugExport=1`), а внутри него — **`planning_snapshot_at_start`**, **`planning_open_now`**, **`planning_closed_recent_48h`**, **`planning_created_in_this_conversation`** для проверки planning/summarizing веток.

Готовые реплики ассистента в списке истории рендерятся `**AssistantBubble**` без служебной строки фазы оркестратора (ранее `phaseLabel` из `turnMode`).

События SSE обрабатываются в `handleSseEvent` (`services/communicator-client.ts`): для `complete` в состояние попадает весь объект `**DialogCompleteEvent**`.

## 4. Конфигурация и параметры


| Источник                                                                      | Назначение                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_COMMUNICATOR_API_URL` (и fallback `EXPO_PUBLIC_BACKEND_API_URL`) | Origin Vercel без суффикса `/api`; см. `services/communicatorConfig.ts`. Отсутствие переменной — ошибка при первом запросе.                                                                                                   |
| URL диалога                                                                   | `getAiDialogUrl()` если в запросе передан `**scenario_id**`, иначе `getCommunicatorV2DialogUrl()`. Текущий `**Communicator**` не передаёт `scenarioId` в `runChatStream` — главный поток всегда использует **v2 dialog URL**. |
| `sendDialogMessage` body                                                      | `scenario_id`, `conversationId`, `useCase`, `entrySource`, `triggerMeta`, `userMessage`, `userTimezone`, optional `turnHistory`.                                                                                               |
| Константы UI                                                                  | `MIN_VOICE_MS` (450), `LOW_TRANSCRIPTION_CONFIDENCE` (0.65), лимит текста 8000 символов.                                                                                                                                      |
| Режим текста                                                                  | `COMMUNICATOR_TEXT_MODE_ENABLED` — если выключен, только голос без переключателя.                                                                                                                                             |
| Дебаг                                                                         | Подпись `model: …` у бейджа ассистента и кнопка `Export dialog to JSON` — только в `**__DEV__`**.                                                                                                                             |
| Ошибки сети / LLM                                                             | Текст перегрузки Gemini (503/429 и т.п.) в `Alert` нормализуется к короткому русскому сообщению, без сырого стектрейса SDK.                                                                                                   |


Из `**complete**` (`DialogCompleteEvent`) в UI и метаданные сообщения попадают как минимум:

- `fullText`, `shouldClose`, `modelUsed`, `modelTier`, `turnMode`, `iteration`, `readyMarkerTriggered`, `validation`, `insightMetrics`
- `branches`, `phaseTime`, `targetChakra` — дополнительный контекст ветвления/фазы, который клиент сохраняет в `meta` и dev-export
- `debugExport` → `meta.debug` в истории (при серверном test/debug режиме)
- `messageId`, `conversationId` — обновление id сообщения и активной беседы
- `practicePicked` → `meta.practicePicked` и общий `PracticeCard`; для **дыхания/медитации** в DTO может быть `**overrides: { durationMin, chakraIndex }**` (`durationMin` после приоритета истории при `confident` и клипа на сервере; см. `assistant/spec.md`); для **йоги** сервер `**overrides`** не присылает — `Communicator` не прокидывает override-пропсы в `PracticeCard`. Опционально `markerIdResolved: false` (если model-generated id не найден в каталоге). Поле `**card_blurb**` — валидированный model-generated текст карточки; `**reason**` остаётся эффективным текстом карточки для UI и legacy-кэша.
- `recommendationCorrected` → `meta.recommendationCorrected`

Поля `**chunk**`: JSON с `text` и опционально `modelUsed`.

## 5. Известные ограничения

- Серверная семантика диалога и выбор практики не дублируются здесь — см. `**docs/02_modules/assistant/spec.md**`.
- Условный выбор URL (`/api/ai/dialog` vs `/api/communicator/v2/dialog`) задан в клиенте; обсуждение техдолга — в `docs/04_workspace/open_questions.md` (раздел `assistant`), не дублировать.
- Калибровочный экран `**app/calibration.tsx**` не использует `Communicator`; только общий транспорт `transcribeCommunicatorAudio` / `extractCalibration`.
- Гейтинг по подписке для основного диалога выполняется на `**app/(tabs)/index.tsx**` (`canUseFeature("assistant_dialog")`), не внутри `Communicator`.

## Справочные материалы

- Параметры записи под Whisper/Hume (16 kHz, mono): `**docs/hume_integration.md**` — согласованы с `core/whisperRecording.ts`.
- Серверный контракт диалога и SSE: `**docs/02_modules/assistant/spec.md**` (без повторения промптов и оркестратора здесь).
- Контракт рекомендации практики в каталоге: `**docs/02_modules/practices/spec.md**` (поля `PracticeRecommendation` / подмножество в `PracticePicked`).