# COMMUNICATOR (React Native / Expo)

Универсальный модуль чата с ИИ: голос (удержание микрофона, **expo-av**) и текст, стриминг ответа через тот же контракт API, что и сервер в **`_legacy_web`** (`POST /api/communicator` на Vercel). Общая архитектура: [`docs/system_structure.md`](../../docs/system_structure.md), дорожная карта: [`docs/modules/communicator_roadmap.md`](../../docs/modules/communicator_roadmap.md).

## Зависимости среды

- **API Gemini**: ключ `GOOGLE_AI_API_KEY` остаётся на сервере (Next route в `_legacy_web`, деплой на Vercel). Клиент ходит только на `EXPO_PUBLIC_COMMUNICATOR_API_URL` (origin без `/api/communicator`).
- **Supabase**: опционально `getSupabase()` в `services/supabase.ts` — те же значения, что `NEXT_PUBLIC_*` в вебе, с префиксом `EXPO_PUBLIC_`.

## Публичный UI

```tsx
import { Communicator } from "@/modules/communicator/ui/Communicator";

<Communicator
  initialMode="VOICE"
  mode="VOICE" // или TXT | VOICE_ONLY | TXT_ONLY
  systemPrompt="…роль и правила для Gemini…"
  history={[]}
  memoryWindow={24}
  onEmotionSegment={(payload) => { /* задел Hume */ }}
  onMessage={(msg) => {}}
  onError={(e) => {}}
  onAbort={() => {}}
  onStateChange={(s) => {}}
/>
```

### Режимы

| `mode`        | Поведение                          |
|---------------|------------------------------------|
| (не задан)    | `initialMode`, переключатель виден |
| `VOICE` / `TXT` | соответствующий режим + переключатель |
| `VOICE_ONLY` / `TXT_ONLY` | один режим, без переключателя |

## Поток данных

1. Клиент: `services/communicator-client.ts` → стрим UTF-8.
2. Парсинг `[T]…[/T]`: `core/transcript-parser.ts` (как в архиве).
3. Системный формат ответа: `core/session-helpers.ts` → `buildSystemInstruction`.

## Ассеты

Иконки микрофона и переключателя: `assets/icons/` (в вебе было `public/icons/`). Подключение через `require()` / `Image`.

## Hume (позже)

`onEmotionSegment` вызывается после записи с `{ mimeType, base64, durationMs }` — совместимо с планом интеграции из `docs/hume_integration.md` (частота/PCM уточняются при подключении сервиса).
