# Модуль COMMUNICATOR

## 1. Назначение

Универсальный UI-модуль чата с ИИ: голос (VOICE) и текст (TXT), стриминг ответа **Gemini 1.5 Flash** через серверный route Next.js. Предназначен для встраивания в экраны других модулей (ASSISTANT, сценарии с контекстом и т.д.).

Демо-страница: [`/communicator`](../../app/communicator/page.tsx).

## 2. Интерфейсы (Inputs / Outputs)

### Импорт

```ts
import { Communicator } from "@/modules/communicator";
```

### Props (`CommunicatorProps`)

| Prop | Тип | Описание |
|------|-----|----------|
| `systemPrompt` | `string` | Инструкция для модели (роль, правила, тон). Дополняется внутренним форматом ответа `[T]…[/T]` + ответ. |
| `initialMode` | `'VOICE' \| 'TXT'` | Стартовый режим UI, если политика режима не фиксирует его жёстко. По умолчанию **VOICE**. |
| `mode` | `CommunicatorModePolicy` | `'VOICE' \| 'TXT'` — старт + переключатель; `'VOICE_ONLY'` / `'TXT_ONLY'` — один режим без переключателя. |
| `history` | `CommunicatorHistoryMessage[]` | Начальная история (роль, текст, опционально `id`, `meta`). |
| `memoryWindow` | `number` | Ограничение числа последних сообщений истории, уходящих в запрос к API. |
| `onEmotionSegment` | `(payload: EmotionSegmentPayload) => void` | **Задел под Hume:** после записи голоса передаётся фрагмент аудио (`mimeType`, `base64`, `durationMs`). В V1 не вызывает внешние API. |
| `onMessage` | `(msg: CommunicatorHistoryMessage) => void` | Каждое зафиксированное сообщение пользователя/ассистента после завершения стрима. |
| `onError` | `(err: Error) => void` | Ошибки сети, микрофона, генерации. |
| `onAbort` | `() => void` | Пользователь отменил запрос (Abort). |
| `onStateChange` | `(state: CommunicatorSessionState) => void` | Фаза сессии, режим UI, `canSwitchMode`. |
| `className` | `string` | Обёртка корневого контейнера. |

### Типы

- `CommunicatorHistoryMessage`: `{ id, role: 'user' \| 'assistant', content, createdAt?, meta? }`
- `EmotionSegmentPayload`: `{ mimeType, base64, durationMs, messageIndex? }`
- `CommunicatorSessionState`: `{ phase, uiMode, canSwitchMode }`

### Формат ответа модели

Модель должна вернуть сначала транскрипцию в тегах `[T]…[/T]`, затем ответ. Парсинг на клиенте: [`core/transcript-parser.ts`](core/transcript-parser.ts).

## 3. Внешние зависимости

- **Клиент:** `fetch` к `POST /api/communicator`, `MediaRecorder`, `AbortController`.
- **Сервер:** `@google/generative-ai`, переменные окружения `GOOGLE_AI_API_KEY` или `GEMINI_API_KEY` (см. [`.env.example`](../../.env.example)).
- **Ассеты UI (все в `public/icons/`):** `mic_button_on.png`, `mic_button_off.png`; переключатель режима — `mode_voice.png`, `mode_txt.png`.

## 4. Логика работы

- **TXT:** текст в поле → стрим → разбор `[T]` / ответ → запись в историю.
- **VOICE:** удержание кнопки → запись → `onEmotionSegment` → отправка аудио в Gemini → стрим и разбор.
- **Отмена:** во время обработки/стрима нажатие на кнопку микрофона → `AbortController.abort()` → `onAbort`.
- **Окно памяти:** `memoryWindow` обрезает только хвост истории для API; полный контент в React state может быть длиннее (при необходимости расширить в ASSISTANT).

## 5. Чеклист теста на iPhone (PWA)

- Развернуть приложение на **HTTPS** (например Vercel).
- В [`manifest.json`](../../public/manifest.json): **icons** `android-icon-192.png` / `android-icon-512.png`, `display: standalone`. В [`app/layout.tsx`](../../app/layout.tsx) в `metadata.icons` те же размеры плюс **apple** → `apple-touch-icon.png` для iOS.
- В Safari: **Поделиться → На экран «Домой»**, открыть установленное приложение.
- При первом использовании голоса выдать разрешение на **микрофон** для сайта.
- На сервере задан `GOOGLE_AI_API_KEY` или `GEMINI_API_KEY` (не публикуйте ключ в клиенте).

## 6. План развития

- Интеграция **Hume** по `onEmotionSegment` (16 kHz, mono, int16 — см. [`docs/hume_integration.md`](../../docs/hume_integration.md)).
- Двухходовая схема / **Gemini Live** — см. [`docs/modules/communicator_roadmap.md`](../../docs/modules/communicator_roadmap.md).
